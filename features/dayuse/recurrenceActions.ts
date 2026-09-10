'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { brtToday } from '@/lib/utils/gridSchedule'
import { recurrenceConflict } from '@/lib/dayuse/recurrence'
import { reaisToCents } from '@/lib/dayuse/dayUseKind'
import { dayUseWindow, generateDayUse } from './generation'
import type { DayUseKind } from '@/types'

export interface CreateDayUseRecurrenceData {
  day_of_week: number
  start_time: string
  end_time: string
  court: number
  capacity: number
  sport?: string | null
  kind?: DayUseKind
  /** Reais como o admin digitou. Vazio herda o padrão da academia. */
  price?: string | null
  notes?: string | null
}

export async function createDayUseRecurrence(
  data: CreateDayUseRecurrenceData,
): Promise<{ error?: string; slotsCreated?: number }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  if (data.start_time >= data.end_time) {
    return { error: 'Horário de fim deve ser depois do início' }
  }
  if (data.capacity < 1) return { error: 'capacidade mínima é 1' }

  const adminClient = createAdminClient()

  // Conflito entre MOLDES, não entre datas: sem esta checagem o choque só
  // apareceria na geração, como violação de índice único dentro do cron —
  // longe do admin que criou o segundo molde.
  const { data: existingRaw } = await adminClient
    .from('dayuse_recurrences')
    .select('day_of_week, court, start_time, end_time')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const clash = recurrenceConflict(data, (existingRaw ?? []) as {
    day_of_week: number; court: number; start_time: string; end_time: string
  }[])
  if (clash) {
    return { error: `Já existe day use recorrente neste espaço e dia às ${clash.slice(0, 5)}.` }
  }

  const priceRaw = (data.price ?? '').trim()

  const { data: created, error } = await adminClient
    .from('dayuse_recurrences')
    .insert({
      organization_id: orgId,
      day_of_week: data.day_of_week,
      start_time: data.start_time,
      end_time: data.end_time,
      court: data.court,
      capacity: data.capacity,
      sport: data.sport || null,
      kind: data.kind ?? 'scheduled',
      price_cents: priceRaw === '' ? null : reaisToCents(priceRaw),
      notes: data.notes || null,
      is_active: true,
      created_by: userId,
    })
    .select('id')
    .single()

  if (error || !created) return { error: error?.message ?? 'Erro ao criar a recorrência' }

  // Gera na hora, sem esperar o cron: criar a recorrência e a agenda continuar
  // vazia até a madrugada seguinte parece que a criação não funcionou.
  const { from, to } = dayUseWindow(brtToday(new Date()))
  const gen = await generateDayUse(orgId, from, to, adminClient)

  revalidatePath('/admin/grade/dayuse')
  revalidatePath('/agendar/dayuse')
  if (gen.error) {
    // A recorrência EXISTE; só a materialização falhou. Dizer isso é diferente
    // de dizer "erro ao criar" — o cron da madrugada tentará de novo.
    return {
      slotsCreated: 0,
      error: `Recorrência criada, mas a geração das datas falhou: ${gen.error}`,
    }
  }
  return { slotsCreated: gen.slotsCreated }
}

export interface DeactivateRecurrenceResult {
  error?: string
  /** Datas futuras recolhidas junto com o molde. */
  slotsRemoved?: number
  /**
   * Datas futuras que FICARAM no ar porque já têm gente reservada. Desativá-las
   * apagaria a reserva de alguém em silêncio — e no caso pago, uma reserva paga.
   */
  slotsKept?: number
}

export async function deactivateDayUseRecurrence(
  recurrenceId: string,
): Promise<DeactivateRecurrenceResult> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()

  const { error: recErr } = await adminClient
    .from('dayuse_recurrences')
    .update({ is_active: false })
    .eq('id', recurrenceId)
    .eq('organization_id', orgId)
  if (recErr) return { error: recErr.message }

  // Desligar o molde tem de recolher o que ele já materializou para o futuro:
  // sem isto o admin desliga o day use de domingo e ele segue aparecendo na
  // agenda por 4 semanas. Datas PASSADAS não se toca — são histórico.
  const today = brtToday(new Date())
  const { data: futureRaw } = await adminClient
    .from('dayuse_slots')
    .select('id')
    .eq('organization_id', orgId)
    .eq('recurrence_id', recurrenceId)
    .eq('is_active', true)
    .gte('date', today)

  const futureIds = ((futureRaw ?? []) as { id: string }[]).map((s) => s.id)
  if (futureIds.length === 0) {
    revalidatePath('/admin/grade/dayuse')
    return { slotsRemoved: 0, slotsKept: 0 }
  }

  const { data: bookedRaw } = await adminClient
    .from('dayuse_bookings')
    .select('slot_id')
    .in('slot_id', futureIds)
    .in('status', ['confirmed', 'pending_payment'])
  const booked = new Set(((bookedRaw ?? []) as { slot_id: string }[]).map((b) => b.slot_id))

  const toRemove = futureIds.filter((id) => !booked.has(id))
  if (toRemove.length > 0) {
    await adminClient.from('dayuse_slots').update({ is_active: false }).in('id', toRemove)
  }

  revalidatePath('/admin/grade/dayuse')
  revalidatePath('/agendar/dayuse')
  return { slotsRemoved: toRemove.length, slotsKept: futureIds.length - toRemove.length }
}

/** "Gerar agora": materializa o horizonte sem esperar a passada do cron. */
export async function generateDayUseNow(): Promise<{ error?: string; slotsCreated?: number }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const { from, to } = dayUseWindow(brtToday(new Date()))
  const r = await generateDayUse(orgId, from, to)
  if (r.error) return { error: r.error }
  revalidatePath('/admin/grade/dayuse')
  revalidatePath('/agendar/dayuse')
  return { slotsCreated: r.slotsCreated }
}
