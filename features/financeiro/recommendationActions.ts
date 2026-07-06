'use server'
// features/financeiro/recommendationActions.ts
// Admin indica um plano+periodicidade; o aluno vê banner no /home e no
// /financeiro. Ao assinar, o webhook marca completed (Task 14).
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'

async function getAdminContext(): Promise<
  { adminClient: ReturnType<typeof createAdminClient>; orgId: string; userId: string } | { error: string }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  return { adminClient, orgId, userId: user.id }
}

export async function recommendPlanToStudent(
  studentId: string,
  planId: string,
  billingOptionId: string,
): Promise<{ error?: string }> {
  const ctx = await getAdminContext()
  if ('error' in ctx) return { error: ctx.error }
  const { adminClient, orgId, userId } = ctx

  // Opção precisa ser do plano e da academia, e estar à venda.
  const { data: option } = await adminClient
    .from('plan_billing_options')
    .select('id, plan_id, is_enabled')
    .eq('id', billingOptionId)
    .eq('organization_id', orgId)
    .single()
  if (!option || option.plan_id !== planId || !option.is_enabled) {
    return { error: 'Opção de plano inválida.' }
  }

  // Uma indicação pendente por aluno: as antigas são dispensadas.
  await adminClient
    .from('plan_recommendations')
    .update({ status: 'dismissed' })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')

  const { error } = await adminClient.from('plan_recommendations').insert({
    organization_id: orgId,
    student_id: studentId,
    plan_id: planId,
    billing_option_id: billingOptionId,
    created_by: userId,
  })
  if (error) return { error: 'Erro ao registrar a indicação.' }

  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// Aluno dispensa o banner.
export async function dismissPlanRecommendation(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .from('plan_recommendations')
    .update({ status: 'dismissed' })
    .eq('id', id)
    .eq('student_id', user.id)
    .eq('status', 'pending')
  if (error) return { error: 'Erro ao dispensar.' }

  revalidatePath('/financeiro')
  revalidatePath('/home')
  return {}
}
