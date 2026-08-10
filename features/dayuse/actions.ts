'use server'

import { revalidatePath } from 'next/cache'
import { awardLigaExtra } from '@/features/liga/extraPoints'
import { createAdminClient, createClient, getActiveOrgId } from '@/lib/supabase/server'
import { validateDayUseSlot } from './validation'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { getSiteUrl } from '@/lib/utils/siteUrl'

export { validateDayUseSlot }

export interface CreateDayUseSlotData {
  court: number
  date: string
  start_time: string
  end_time: string
  capacity: number
  notes?: string
}

export async function createDayUseSlot(data: CreateDayUseSlotData): Promise<{ error?: string }> {
  const validation = validateDayUseSlot(data.start_time, data.end_time, data.capacity)
  if (validation.error) return validation

  // organization_id é informado explicitamente: o trigger trg_set_org de dayuse_slots
  // foi removido no cutover de identidade (plano 3).
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: { user } } = await adminClient.auth.getUser()

  const { error } = await adminClient.from('dayuse_slots').insert({
    ...data,
    organization_id: orgId,
    notes: data.notes || null,
    created_by: user?.id,
    is_active: true,
  })

  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

export async function deactivateDayUseSlot(slotId: string): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('dayuse_slots')
    .update({ is_active: false })
    .eq('id', slotId)
  if (error) return { error: error.message }
  revalidatePath('/admin/grade/dayuse')
  return {}
}

export async function bookDayUse(slotId: string): Promise<{ error?: string; initPoint?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const adminClient = createAdminClient()

  // Org do slot (day use pago é configuração por academia).
  const { data: slot } = await adminClient
    .from('dayuse_slots')
    .select('organization_id')
    .eq('id', slotId)
    .eq('is_active', true)
    .maybeSingle()
  if (!slot) return { error: 'Slot não encontrado' }
  const orgId = slot.organization_id as string

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

  const { data: settingsRaw } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['day_use_price', 'day_use_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const price = parseFloat(settings.day_use_price ?? '0') || 0
  const token = settings.day_use_sale_enabled === 'true' && price > 0
    ? await getConnectedMpToken(orgId)
    : null
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
      items: [{ title: 'Day Use', quantity: 1, unit_price: price, currency_id: 'BRL' }],
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
