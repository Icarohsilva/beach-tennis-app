'use server'
// app/(admin)/admin/dashboard/trialActions.ts
// Ações do admin sobre aulas experimentais (trial_bookings): confirmar presença
// ou excluir. Usam service role (createAdminClient) mas SEMPRE escopadas pelo
// organization_id da academia ativa do staff logado — isolamento multi-tenant.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'

// Marca a experimental como comparecida (confirma o aluno).
export async function confirmTrialBooking(trialId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Acesso negado.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('trial_bookings')
    .update({ status: 'attended' })
    .eq('id', trialId)
    .eq('organization_id', ctx.organizationId)
  if (error) return { error: 'Não foi possível confirmar a aula experimental.' }

  revalidatePath('/admin/dashboard')
  return {}
}

// Exclui o agendamento experimental.
export async function deleteTrialBooking(trialId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Acesso negado.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('trial_bookings')
    .delete()
    .eq('id', trialId)
    .eq('organization_id', ctx.organizationId)
  if (error) return { error: 'Não foi possível excluir a aula experimental.' }

  revalidatePath('/admin/dashboard')
  return {}
}
