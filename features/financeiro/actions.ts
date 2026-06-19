'use server'
// features/financeiro/actions.ts

import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import type { PaymentType } from '@/types'
import { reconcileEnrollmentCredits } from '@/features/aulas/creditReconciliation'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { normalizeSports } from '@/lib/arenas/sports'

// ---------------------------------------------------------------------------
// subscribeToPlan
// ---------------------------------------------------------------------------

/**
 * Creates a student_subscription for the authenticated student.
 * - Blocks Wellhub/TotalPass users (they don't use subscriptions)
 * - payer_id = parent_id if is_dependent, else student's own id
 * - Deactivates any existing active subscription first
 */
export async function subscribeToPlan(
  planId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Dados por-academia (payment_type/dependente) vêm da membership da academia ativa.
  const membership = await getActiveMembership()
  if (!membership) return { error: 'Perfil não encontrado.' }

  const paymentType = membership.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  // Fetch plan (escopado pela academia ativa)
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month, name')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()

  if (planErr || !plan) return { error: 'Plano não encontrado.' }
  if (!plan.is_active) return { error: 'Este plano não está disponível.' }

  // payer_id: dependent uses parent; otherwise self
  const payerId = membership.is_dependent && membership.parent_id ? membership.parent_id : user.id

  // Cancel existing active subscriptions (nesta academia)
  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')

  // Next billing = 1st day of next month
  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
      organization_id: orgId,
      student_id: user.id,
      payer_id: payerId,
      plan_id: planId,
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: nextBilling.toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()

  if (insertErr || !newSub) return { error: 'Erro ao criar assinatura. Tente novamente.' }

  // Concede créditos proporcionais reconciliando as matrículas ativas do aluno
  const { data: activeEnrolls } = await adminClient
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const { from, to } = getRemainingMonthWindow(new Date())
  for (const e of (activeEnrolls ?? []) as { class_id: string }[]) {
    await reconcileEnrollmentCredits(user.id, e.class_id, from, to)
  }

  return {}
}

// ---------------------------------------------------------------------------
// adminSubscribeStudentToPlan (admin only)
// ---------------------------------------------------------------------------

/**
 * Assigns a subscription plan to any student. Admin only.
 * - Deactivates any existing active subscription
 * - Grants prorated credits by reconciling the student's active enrollments
 *   over the remaining month (reconcileEnrollmentCredits)
 * - For is_dependent students: payer_id = parent_id
 * - Calls revalidatePath for the admin student page
 */
export async function adminSubscribeStudentToPlan(
  studentId: string,
  planId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Verify caller is admin na academia ativa (papel vive na membership).
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão de administrador.' }

  // Dados por-academia do aluno vêm da membership desta academia.
  const { data: student, error: studentErr } = await adminClient
    .from('memberships')
    .select('payment_type, is_dependent, parent_id, contract_active')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()

  if (studentErr || !student) return { error: 'Aluno não encontrado.' }

  const paymentType = student.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  // Fetch plan (escopado pela academia ativa)
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month')
    .eq('id', planId)
    .eq('organization_id', orgId)
    .single()

  if (planErr || !plan) return { error: 'Plano não encontrado.' }
  if (!plan.is_active) return { error: 'Este plano não está disponível.' }

  // payer_id: dependent uses parent; otherwise self
  const payerId = student.is_dependent && student.parent_id ? student.parent_id : studentId

  // Cancel existing active subscriptions (nesta academia)
  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')

  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
      organization_id: orgId,
      student_id: studentId,
      payer_id: payerId,
      plan_id: planId,
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: null,
      next_billing_at: nextBilling.toISOString(),
      discount_pct: 0,
      gateway_subscription_id: null,
    })
    .select('id')
    .single()

  if (insertErr) return { error: 'Erro ao criar assinatura. Tente novamente.' }

  // Concede créditos proporcionais reconciliando as matrículas ativas do aluno
  if (newSub) {
    const { data: activeEnrolls } = await adminClient
      .from('enrollments')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('organization_id', orgId)
      .eq('is_active', true)

    const { from, to } = getRemainingMonthWindow(new Date())
    for (const e of (activeEnrolls ?? []) as { class_id: string }[]) {
      await reconcileEnrollmentCredits(studentId, e.class_id, from, to)
    }
  }

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/admin/alunos/${studentId}`)

  return {}
}

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------

/**
 * Cancels the authenticated student's active subscription.
 * Also invalidates all makeup credits (expires_at IS NOT NULL) by inserting
 * 'expired' transactions and zeroing the credits_balance.
 */
export async function cancelSubscription(): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Find active subscription (na academia ativa)
  const { data: sub, error: subErr } = await adminClient
    .from('student_subscriptions')
    .select('id, organization_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .single()

  if (subErr || !sub) return { error: 'Nenhuma assinatura ativa encontrada.' }

  // Cancel subscription
  const { error: cancelErr } = await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', sub.id)

  if (cancelErr) return { error: 'Erro ao cancelar assinatura.' }

  // Expira todos os créditos restantes ao cancelar o contrato.
  // Saldo é por-academia: vem da membership da academia da assinatura.
  // adjust_credits mantém ledger e saldo consistentes na mesma transação.
  const { data: membershipRow } = await adminClient
    .from('memberships')
    .select('credits_balance')
    .eq('user_id', user.id)
    .eq('organization_id', sub.organization_id)
    .single()

  const remaining = (membershipRow?.credits_balance as number) ?? 0
  if (remaining > 0) {
    const { error: expireErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: user.id,
      p_org: sub.organization_id,
      p_delta: -remaining,
      p_type: 'expired',
      p_reason: 'Cancelamento de contrato — créditos expirados',
    })
    if (expireErr) {
      console.error('[cancelSubscription] adjust_credits falhou', {
        studentId: user.id, error: expireErr.message,
      })
    }
  }

  return {}
}

// ---------------------------------------------------------------------------
// adminCancelStudentPlan — admin cancels a student's plan, optionally zeroing credits
// ---------------------------------------------------------------------------

export async function adminCancelStudentPlan(
  studentId: string,
  clearCredits: boolean,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Papel é por-academia: vem da membership da academia ativa.
  const { data: caller } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (caller?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: sub } = await adminClient
    .from('student_subscriptions')
    .select('id, organization_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (!sub) return { error: 'Nenhum plano ativo encontrado.' }

  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', sub.id)

  if (clearCredits) {
    // Saldo é por-academia: vem da membership da academia da assinatura.
    const { data: membershipRow } = await adminClient
      .from('memberships')
      .select('credits_balance')
      .eq('user_id', studentId)
      .eq('organization_id', sub.organization_id)
      .single()

    const balance = (membershipRow?.credits_balance as number) ?? 0
    if (balance > 0) {
      const { error: expireErr } = await adminClient.rpc('adjust_credits', {
        p_student_id: studentId,
        p_org: sub.organization_id,
        p_delta: -balance,
        p_type: 'expired',
        p_reason: 'Cancelamento de plano pelo admin — créditos zerados',
      })
      if (expireErr) {
        console.error('[adminCancelStudentPlan] adjust_credits falhou', {
          studentId, error: expireErr.message,
        })
        return { error: 'Plano cancelado, mas houve um erro ao zerar os créditos.' }
      }
    }
  }

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/admin/alunos/${studentId}`)
  return {}
}

// ---------------------------------------------------------------------------
// applyDiscount (admin only)
// ---------------------------------------------------------------------------

/**
 * Applies a discount percentage to a student's active subscription.
 * Only admin can call this.
 */
export async function applyDiscount(
  subscriptionId: string,
  discountPct: number,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Papel é por-academia: vem da membership da academia ativa.
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  if (discountPct < 0 || discountPct > 100) {
    return { error: 'Desconto deve estar entre 0 e 100.' }
  }

  const { error: updateErr } = await adminClient
    .from('student_subscriptions')
    .update({ discount_pct: discountPct })
    .eq('id', subscriptionId)
    .eq('organization_id', orgId)

  if (updateErr) return { error: 'Erro ao aplicar desconto.' }

  return {}
}

// ---------------------------------------------------------------------------
// updateSystemSettings (admin only)
// ---------------------------------------------------------------------------

/**
 * Updates system_settings fields credit_expiry_days and cancellation_window_hours.
 * Only admin can call this.
 */
export async function updateSystemSettings(settings: {
  credit_expiry_days?: number
  cancellation_window_hours?: number
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Papel é por-academia: vem da membership da academia ativa.
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  // system_settings é key/value por academia: uma linha por chave, PK (organization_id, key).
  const rows = Object.entries(settings)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => ({ organization_id: orgId, key, value: String(value) }))

  if (rows.length > 0) {
    const { error: updateErr } = await adminClient
      .from('system_settings')
      .upsert(rows, { onConflict: 'organization_id,key' })

    if (updateErr) return { error: 'Erro ao salvar configurações.' }
  }

  return {}
}

// ---------------------------------------------------------------------------
// updateOrgListing (owner only) — vitrine pública no diretório /arenas
// ---------------------------------------------------------------------------

export async function updateOrgListing(input: {
  is_listed: boolean
  cep: string
  state: string
  city: string
  neighborhood: string
  address_line: string
  address_number: string
  no_number: boolean
  sports: string[]
  whatsapp: string
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Só o dono da academia edita a vitrine. Papel é por-academia (membership).
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .single()
  if ((org as { owner_id: string | null } | null)?.owner_id !== user.id) {
    return { error: 'Sem permissão.' }
  }

  const { error: updateErr } = await adminClient
    .from('organizations')
    .update({
      is_listed: input.is_listed,
      cep: input.cep.trim() || null,
      state: input.state.trim().toUpperCase() || null,
      city: input.city.trim() || null,
      neighborhood: input.neighborhood.trim() || null,
      address_line: input.address_line.trim() || null,
      address_number: input.no_number ? null : input.address_number.trim() || null,
      no_number: input.no_number,
      sports: normalizeSports(input.sports),
      whatsapp: input.whatsapp.trim() || null,
    })
    .eq('id', orgId)

  if (updateErr) return { error: 'Erro ao salvar a vitrine.' }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/admin/configuracoes')
  revalidatePath('/arenas')
  return {}
}
