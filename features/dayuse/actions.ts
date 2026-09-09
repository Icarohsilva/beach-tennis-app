'use server'

import { revalidatePath } from 'next/cache'
import { awardLigaExtra } from '@/features/liga/extraPoints'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateDayUseSlot } from './validation'
import { requireAdmin } from '@/features/aulas/authGuards'
import { brtToday } from '@/lib/utils/gridSchedule'
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import {
  dayUseChargeCents,
  dayUseChargeTitle,
  reaisToCents,
} from '@/lib/dayuse/dayUseKind'
import { getDayUsePricing } from './pricing'
import { sportLabel } from '@/lib/arenas/sports'
import type { DayUseKind } from '@/types'

export { validateDayUseSlot }

export interface CreateDayUseSlotData {
  court: number
  date: string
  start_time: string
  end_time: string
  capacity: number
  /** Slug de lib/arenas/sports.ts. null = sem modalidade declarada. */
  sport?: string | null
  kind?: DayUseKind
  /**
   * Preço em REAIS como o admin digitou ('40', '39,90', '0'). String vazia ou
   * null = herda o padrão da academia; '0' = este day use é gratuito. A
   * distinção entre "não configurei" e "é de graça" é o que se perderia
   * mandando número direto.
   */
  price?: string | null
  notes?: string
}

export async function createDayUseSlot(data: CreateDayUseSlotData): Promise<{ error?: string }> {
  // requireAdmin e não getActiveOrgId: criar day use é ato de admin, e sem esta
  // guarda qualquer aluno logado criava slot na academia dele — o resto das
  // actions administrativas (features/aulas/adminActions.ts) já entra por aqui.
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  // Conflito de horário na MESMA quadra e data. A regra é pura
  // (validation.ts); aqui só se busca o que ela precisa comparar.
  const { data: sameCourtRaw } = await adminClient
    .from('dayuse_slots')
    .select('start_time, end_time')
    .eq('organization_id', orgId)
    .eq('date', data.date)
    .eq('court', data.court)
    .eq('is_active', true)

  const validation = validateDayUseSlot({
    start_time: data.start_time,
    end_time: data.end_time,
    capacity: data.capacity,
    date: data.date,
    today: brtToday(new Date()),
    sameCourtSlots: (sameCourtRaw ?? []) as { start_time: string; end_time: string }[],
  })
  if (validation.error) return validation

  // Preço: vazio herda o padrão da academia (price_cents null), '0' é escolha
  // explícita de day use gratuito. Ver reaisToCents/dayUsePriceCents.
  const priceRaw = (data.price ?? '').trim()
  const priceCents = priceRaw === '' ? null : reaisToCents(priceRaw)

  const fields = {
    capacity: data.capacity,
    end_time: data.end_time,
    sport: data.sport || null,
    kind: data.kind ?? 'scheduled',
    price_cents: priceCents,
    notes: data.notes || null,
  }

  // Slot REMOVIDO no mesmo espaço, data e horário de início: reativa em vez de
  // inserir. Sem isto o admin que remove um day use e recria o mesmo horário
  // levava violação do índice único dayuse_slots_org_court_date_start_key
  // ("duplicate key value") — a validação de conflito acima só olha slot ativo,
  // e o índice, o horário físico, ativo ou não.
  const { data: removed } = await adminClient
    .from('dayuse_slots')
    .select('id')
    .eq('organization_id', orgId)
    .eq('date', data.date)
    .eq('court', data.court)
    .eq('start_time', data.start_time)
    .eq('is_active', false)
    .maybeSingle()

  if (removed) {
    const { error: reErr } = await adminClient
      .from('dayuse_slots')
      .update({ ...fields, is_active: true, created_by: userId })
      .eq('id', (removed as { id: string }).id)
    if (reErr) return { error: reErr.message }
    revalidatePath('/admin/grade/dayuse')
    revalidatePath('/agendar/dayuse')
    return {}
  }

  // organization_id é informado explicitamente: o trigger trg_set_org de dayuse_slots
  // foi removido no cutover de identidade (plano 3).
  const { error } = await adminClient.from('dayuse_slots').insert({
    ...fields,
    court: data.court,
    date: data.date,
    start_time: data.start_time,
    organization_id: orgId,
    created_by: userId,
    is_active: true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  revalidatePath('/agendar/dayuse')
  return {}
}

export async function deactivateDayUseSlot(slotId: string): Promise<{ error?: string }> {
  // Sem requireAdmin + escopo por organização, esta action desativava slot de
  // QUALQUER academia para qualquer usuário logado que soubesse o id.
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('dayuse_slots')
    .update({ is_active: false })
    .eq('id', slotId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

export async function bookDayUse(slotId: string): Promise<{ error?: string; initPoint?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const adminClient = createAdminClient()

  // Org, preço e modalidade do slot: o preço é DESTE day use quando ele tem um,
  // e o da academia quando não (dayUsePriceCents).
  const { data: slot } = await adminClient
    .from('dayuse_slots')
    .select('organization_id, sport, date, price_cents')
    .eq('id', slotId)
    .eq('is_active', true)
    .maybeSingle()
  if (!slot) return { error: 'Slot não encontrado' }
  const slotRow = slot as {
    organization_id: string
    sport: string | null
    date: string
    price_cents: number | null
  }
  const orgId = slotRow.organization_id

  // Quem reserva vindo de fora (conta livre, descoberta pela aba Explorar) vira
  // ATLETA daquela academia. O vínculo é o que a RLS usa para ele enxergar a
  // própria reserva depois — e o papel distinto mantém quem só passou por um
  // day use fora da lista de alunos do professor.
  //
  // `ignoreDuplicates` protege quem já é aluno (ou admin) de ser rebaixado.
  await adminClient
    .from('memberships')
    .upsert(
      { user_id: user.id, organization_id: orgId, role: 'athlete' },
      { onConflict: 'user_id,organization_id', ignoreDuplicates: true },
    )

  // Mesma resolução que o card do aluno e a página pública usam para EXIBIR o
  // preço, para tela e cobrança não divergirem.
  const pricing = await getDayUsePricing(orgId)
  // Centavos são a unidade de verdade (price_cents do slot); os reais só existem
  // porque a preferência do Mercado Pago e payments.amount são em reais.
  const priceCents = dayUseChargeCents(slotRow, pricing)
  const price = priceCents / 100
  const token = priceCents > 0 ? pricing.mpToken : null
  const isPaid = Boolean(token)

  // Capacidade + insert atômicos via RPC (advisory lock por slot). Caminho
  // pago reserva como pending_payment: ocupa a vaga por 30 min (a RPC conta
  // pendentes frescos) até o webhook confirmar.
  const { data: bookingId, error } = await adminClient.rpc('book_dayuse_atomic', {
    p_student_id: user.id,
    p_slot_id: slotId,
    p_status: isPaid ? 'pending_payment' : 'confirmed',
  })

  if (error) {
    if (error.message.includes('SLOT_FULL')) return { error: 'Este horário está lotado.' }
    if (error.message.includes('ALREADY_BOOKED')) return { error: 'Você já tem uma reserva neste horário' }
    if (error.message.includes('SLOT_NOT_FOUND')) return { error: 'Slot não encontrado' }
    return { error: 'Erro ao reservar. Tente novamente.' }
  }

  if (!isPaid) {
    // Liga: só o caminho gratuito credita aqui. No caminho pago a reserva nasce
    // pending_payment e ainda pode não virar nada — quem credita é o webhook, ao
    // confirmar o pagamento.
    await awardLigaExtra(adminClient, {
      orgId,
      studentId: user.id,
      reason: 'dayuse',
      sourceId: bookingId as string,
    })

    revalidatePath('/agendar/dayuse')
    revalidatePath('/home')
    return {}
  }

  // Caminho pago: payment pending + preferência de checkout.
  const { data: payment, error: payErr } = await adminClient
    .from('payments')
    .insert({
      organization_id: orgId,
      student_id: user.id,
      subscription_id: null,
      session_id: null,
      amount: price,
      currency: 'BRL',
      status: 'pending',
      type: 'day_use',
      gateway: 'mercadopago',
      gateway_payment_id: null,
      dayuse_booking_id: bookingId as string,
    })
    .select('id')
    .single()

  if (payErr || !payment) {
    await adminClient
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId as string)
    return { error: 'Erro ao iniciar o pagamento. Tente novamente.' }
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(token as string, {
      items: [{
        title: dayUseChargeTitle({
          sportLabel: slotRow.sport ? sportLabel(slotRow.sport) : null,
          date: slotRow.date,
        }),
        quantity: 1,
        unit_price: price,
        currency_id: 'BRL',
      }],
      external_reference: payment.id as string,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(price, feePct),
    })
    revalidatePath('/agendar/dayuse')
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[dayuse] preference falhou', e)
    await adminClient
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId as string)
    await adminClient.from('payments').update({ status: 'failed' }).eq('id', payment.id)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}

export async function cancelDayUseBooking(bookingId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { error } = await supabase
    .from('dayuse_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('student_id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/agendar/dayuse')
  revalidatePath('/home')
  return {}
}
