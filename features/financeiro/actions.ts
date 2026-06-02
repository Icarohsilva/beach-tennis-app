'use server'
// features/financeiro/actions.ts

import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { PaymentType } from '@/types'

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

  // Fetch student profile
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, payment_type, is_dependent, parent_id, contract_active')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) return { error: 'Perfil não encontrado.' }

  const paymentType = profile.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  // Fetch plan
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month, name')
    .eq('id', planId)
    .single()

  if (planErr || !plan) return { error: 'Plano não encontrado.' }
  if (!plan.is_active) return { error: 'Este plano não está disponível.' }

  // payer_id: dependent uses parent; otherwise self
  const payerId = profile.is_dependent && profile.parent_id ? profile.parent_id : user.id

  // Cancel existing active subscriptions
  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', user.id)
    .eq('status', 'active')

  // Next billing = 1st day of next month
  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
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

  // Grant initial credits if the plan includes monthly credits
  const credits = plan.credits_per_month as number
  if (credits > 0) {
    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'renewed',
      amount: credits,
      reason: `Créditos iniciais — plano ${plan.name}`,
      session_id: null,
      subscription_id: newSub.id,
      expires_at: null,
    })
    await adminClient
      .from('profiles')
      .update({ credits_balance: credits })
      .eq('id', user.id)
  }

  return {}
}

// ---------------------------------------------------------------------------
// adminSubscribeStudentToPlan (admin only)
// ---------------------------------------------------------------------------

/**
 * Assigns a subscription plan to any student. Admin only.
 * - Deactivates any existing active subscription
 * - Grants initial credits equal to the plan's credits_per_month
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

  // Verify caller is admin
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão de administrador.' }

  // Fetch student profile
  const { data: student, error: studentErr } = await adminClient
    .from('profiles')
    .select('id, payment_type, is_dependent, parent_id, contract_active')
    .eq('id', studentId)
    .single()

  if (studentErr || !student) return { error: 'Aluno não encontrado.' }

  const paymentType = student.payment_type as PaymentType
  if (paymentType === 'wellhub' || paymentType === 'totalpass') {
    return { error: 'Alunos Wellhub/TotalPass não precisam de assinatura no app.' }
  }

  // Fetch plan
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, credits_per_month')
    .eq('id', planId)
    .single()

  if (planErr || !plan) return { error: 'Plano não encontrado.' }
  if (!plan.is_active) return { error: 'Este plano não está disponível.' }

  // payer_id: dependent uses parent; otherwise self
  const payerId = student.is_dependent && student.parent_id ? student.parent_id : studentId

  // Cancel existing active subscriptions
  await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', studentId)
    .eq('status', 'active')

  const now = new Date()
  const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const { data: newSub, error: insertErr } = await adminClient
    .from('student_subscriptions')
    .insert({
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

  // Grant initial credits
  const creditsToGrant = (plan as { id: string; is_active: boolean; credits_per_month: number }).credits_per_month
  if (creditsToGrant > 0 && newSub) {
    const sub = newSub as { id: string }
    await adminClient.from('credit_transactions').insert({
      student_id: studentId,
      type: 'renewed',
      amount: creditsToGrant,
      reason: 'Créditos iniciais — associação de plano pelo admin',
      session_id: null,
      subscription_id: sub.id,
      expires_at: null,
    })

    await adminClient
      .from('profiles')
      .update({ credits_balance: creditsToGrant })
      .eq('id', studentId)
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

  // Find active subscription
  const { data: sub, error: subErr } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', user.id)
    .eq('status', 'active')
    .single()

  if (subErr || !sub) return { error: 'Nenhuma assinatura ativa encontrada.' }

  // Cancel subscription
  const { error: cancelErr } = await adminClient
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', sub.id)

  if (cancelErr) return { error: 'Erro ao cancelar assinatura.' }

  // Invalidate makeup credits (expires_at IS NOT NULL)
  const { data: makeupCredits } = await adminClient
    .from('credit_transactions')
    .select('id, amount')
    .eq('student_id', user.id)
    .not('expires_at', 'is', null)
    .in('type', ['refunded'])

  if (makeupCredits && makeupCredits.length > 0) {
    const totalToExpire = makeupCredits.reduce(
      (sum: number, t: { amount: number }) => sum + t.amount,
      0,
    )

    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'expired',
      amount: -totalToExpire,
      reason: 'Cancelamento de contrato — créditos de reposição expirados',
      session_id: null,
      subscription_id: sub.id,
      expires_at: null,
    })

    // Update cached balance: set to 0
    await adminClient
      .from('profiles')
      .update({ credits_balance: 0 })
      .eq('id', user.id)
  }

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

  // Verify caller is admin
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão.' }

  if (discountPct < 0 || discountPct > 100) {
    return { error: 'Desconto deve estar entre 0 e 100.' }
  }

  const { error: updateErr } = await adminClient
    .from('student_subscriptions')
    .update({ discount_pct: discountPct })
    .eq('id', subscriptionId)

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

  // Verify caller is admin
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão.' }

  const { error: updateErr } = await adminClient
    .from('system_settings')
    .update(settings)
    .not('id', 'is', null)

  if (updateErr) return { error: 'Erro ao salvar configurações.' }

  return {}
}
