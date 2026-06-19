'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient, createClient, getActiveOrgId } from '@/lib/supabase/server'
import { validateDayUseSlot } from './validation'

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

export async function bookDayUse(slotId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data: slot } = await supabase
    .from('dayuse_slots')
    .select('id, capacity')
    .eq('id', slotId)
    .single()
  if (!slot) return { error: 'Slot não encontrado' }

  // Capacity check: count confirmed bookings for this slot
  const { count: confirmedCount } = await supabase
    .from('dayuse_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .eq('status', 'confirmed')

  if ((confirmedCount ?? 0) >= (slot as { id: string; capacity: number }).capacity) {
    return { error: 'Este horário está lotado.' }
  }

  const { error } = await supabase.from('dayuse_bookings').insert({
    slot_id: slotId,
    student_id: user.id,
    status: 'confirmed',
  })

  if (error?.code === '23505') return { error: 'Você já tem uma reserva neste horário' }
  if (error) return { error: error.message }

  revalidatePath('/agendar/dayuse')
  revalidatePath('/home')
  return {}
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
