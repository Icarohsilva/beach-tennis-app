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
  const { data: trial } = await admin
    .from('trial_bookings')
    .select('student_id, session_id')
    .eq('id', trialId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle()

  const { error } = await admin
    .from('trial_bookings')
    .delete()
    .eq('id', trialId)
    .eq('organization_id', ctx.organizationId)
  if (error) return { error: 'Não foi possível excluir a aula experimental.' }

  // A experimental com conta é uma reserva de verdade: excluir tem de liberar a
  // vaga na turma e tirar a aula grátis declarada, senão a pessoa seguiria na
  // chamada. A conta e o vínculo ficam: são dela, e excluir a experimental também
  // libera o CPF para uma nova.
  const t = trial as { student_id: string | null; session_id: string } | null
  if (t?.student_id) {
    await admin
      .from('session_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('student_id', t.student_id)
      .eq('session_id', t.session_id)
      .eq('status', 'confirmed')
    await admin
      .from('payments')
      .delete()
      .eq('student_id', t.student_id)
      .eq('session_id', t.session_id)
      .eq('type', 'trial')
      .eq('organization_id', ctx.organizationId)
    revalidatePath(`/admin/grade/${t.session_id}`)
  }

  revalidatePath('/admin/dashboard')
  return {}
}
