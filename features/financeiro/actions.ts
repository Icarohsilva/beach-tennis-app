'use server'
// features/financeiro/actions.ts

import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { reconcileEnrollmentCredits } from '@/features/aulas/reconcileEnrollment'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { normalizeSports } from '@/lib/arenas/sports'
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpCancelPreapproval } from '@/lib/billing/mpClient'

// ---------------------------------------------------------------------------
// subscribeToPlan
// ---------------------------------------------------------------------------

/**
 * Creates a student_subscription for the authenticated student.
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

  // Fetch plan (escopado pela academia ativa)
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active, name')
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

  // Reserva as sessões das matrículas ativas do aluno (não concede crédito —
  // plano é acesso ilimitado desde 2026-07).
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
 * - Reserves the student's active enrollment sessions by reconciling (does
 *   not grant credit — plan is unlimited access)
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
    .select('is_dependent, parent_id, contract_active')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .single()

  if (studentErr || !student) return { error: 'Aluno não encontrado.' }

  // Fetch plan (escopado pela academia ativa)
  const { data: plan, error: planErr } = await adminClient
    .from('subscription_plans')
    .select('id, is_active')
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

  // Reserva as sessões das matrículas ativas do aluno (não concede crédito —
  // plano é acesso ilimitado desde 2026-07).
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

  // Find active subscription (na academia ativa). Inclui pending_payment:
  // o aluno pode desistir de uma assinatura que criou mas nunca autorizou o
  // pagamento no MP, sem esperar a limpeza automática de 24h.
  const { data: sub, error: subErr } = await adminClient
    .from('student_subscriptions')
    .select('id, organization_id, gateway, gateway_subscription_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .maybeSingle()

  if (subErr || !sub) return { error: 'Nenhuma assinatura ativa encontrada.' }

  // MP primeiro: nunca deixar o MP cobrando um plano morto. Falhou → aborta.
  if (sub.gateway === 'mercadopago' && sub.gateway_subscription_id) {
    const account = await getMpAccount(sub.organization_id)
    if (!account) return { error: 'Não foi possível cancelar no Mercado Pago. Fale com a academia.' }
    try {
      await mpCancelPreapproval(account.accessToken, sub.gateway_subscription_id)
    } catch (e) {
      console.error('[cancelSubscription] MP cancel falhou', e)
      return { error: 'Não foi possível cancelar no Mercado Pago. Tente novamente.' }
    }
  }

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

  // Inclui pending_payment: a academia também precisa poder cancelar uma
  // assinatura travada aguardando pagamento, não só um plano já ativo.
  const { data: sub } = await adminClient
    .from('student_subscriptions')
    .select('id, organization_id, gateway, gateway_subscription_id')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .maybeSingle()

  if (!sub) return { error: 'Nenhum plano ativo encontrado.' }

  // MP primeiro: nunca deixar o MP cobrando um plano morto. Falhou → aborta.
  if (sub.gateway === 'mercadopago' && sub.gateway_subscription_id) {
    const account = await getMpAccount(sub.organization_id)
    if (!account) return { error: 'Não foi possível cancelar no Mercado Pago. Fale com a academia.' }
    try {
      await mpCancelPreapproval(account.accessToken, sub.gateway_subscription_id)
    } catch (e) {
      console.error('[adminCancelStudentPlan] MP cancel falhou', e)
      return { error: 'Não foi possível cancelar no Mercado Pago. Tente novamente.' }
    }
  }

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
  default_checkin_target?: number
  grid_auto_enabled?: boolean
  grid_auto_day?: number
  grid_auto_hour?: number
  pix_key?: string
  pix_key_owner?: string
  debt_block_grace_days?: number
  quota_enforcement_enabled?: boolean
  max_classes_per_day?: number
  video_feed_url?: string
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

  if (
    settings.default_checkin_target !== undefined &&
    (!Number.isInteger(settings.default_checkin_target) || settings.default_checkin_target < 0)
  ) {
    return { error: 'Meta mensal de check-ins inválida.' }
  }

  if (
    settings.grid_auto_day !== undefined &&
    (!Number.isInteger(settings.grid_auto_day) || settings.grid_auto_day < 0 || settings.grid_auto_day > 6)
  ) {
    return { error: 'Dia da geração automática inválido.' }
  }
  if (
    settings.grid_auto_hour !== undefined &&
    (!Number.isInteger(settings.grid_auto_hour) || settings.grid_auto_hour < 0 || settings.grid_auto_hour > 23)
  ) {
    return { error: 'Hora da geração automática inválida.' }
  }
  if (
    settings.debt_block_grace_days !== undefined &&
    (!Number.isInteger(settings.debt_block_grace_days) ||
      settings.debt_block_grace_days < 0 ||
      settings.debt_block_grace_days > 90)
  ) {
    return { error: 'Carência de bloqueio inválida (0 a 90 dias).' }
  }

  if (
    settings.max_classes_per_day !== undefined &&
    (!Number.isInteger(settings.max_classes_per_day) || settings.max_classes_per_day < 1)
  ) {
    return { error: 'Máximo de aulas por dia inválido.' }
  }

  if (
    settings.video_feed_url !== undefined &&
    settings.video_feed_url !== '' &&
    !/^https?:\/\//i.test(settings.video_feed_url)
  ) {
    return { error: 'URL do site de vídeos deve começar com http:// ou https://.' }
  }

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

// ---------------------------------------------------------------------------
// updateOrgSelfCheckin (owner only) — ponto da quadra p/ confirmação de presença
// ---------------------------------------------------------------------------

export async function updateOrgSelfCheckin(input: {
  enabled: boolean
  latitude: number | null
  longitude: number | null
  radiusM: number
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Mesma regra da vitrine: só o dono mexe na configuração da academia.
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

  const hasPoint = input.latitude !== null && input.longitude !== null
  if (hasPoint) {
    if (!Number.isFinite(input.latitude!) || Math.abs(input.latitude!) > 90) {
      return { error: 'Latitude inválida.' }
    }
    if (!Number.isFinite(input.longitude!) || Math.abs(input.longitude!) > 180) {
      return { error: 'Longitude inválida.' }
    }
  }
  if (!Number.isInteger(input.radiusM) || input.radiusM < 20 || input.radiusM > 5000) {
    return { error: 'O raio deve ficar entre 20 e 5000 metros.' }
  }
  // Sem ponto, toda confirmação cairia como pendente — vira fila de trabalho
  // para o professor em vez de automação. Melhor barrar aqui.
  if (input.enabled && !hasPoint) {
    return { error: 'Marque a localização da academia antes de habilitar a confirmação.' }
  }

  const { error: updateErr } = await adminClient
    .from('organizations')
    .update({
      self_checkin_enabled: input.enabled,
      latitude: input.latitude,
      longitude: input.longitude,
      checkin_radius_m: input.radiusM,
    })
    .eq('id', orgId)

  if (updateErr) return { error: `Erro ao salvar a confirmação de presença: ${updateErr.message}` }

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/admin/configuracoes')
  revalidatePath('/home')
  return {}
}
