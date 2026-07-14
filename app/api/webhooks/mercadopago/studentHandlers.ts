// app/api/webhooks/mercadopago/studentHandlers.ts
// Billing aluno→academia. Regra de ouro: NADA é creditado/ativado com base no
// corpo do webhook — sempre re-consultamos a API do MP com o token da academia
// dona. Erros lançados aqui viram 500 no route → o MP reentrega o evento.
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpGetPreapproval, mpGetAuthorizedPayment } from '@/lib/billing/mpClient'
import { mapStudentPreapprovalStatus } from '@/lib/billing/studentSubscriptionStatus'
import { addPeriod } from '@/lib/billing/periodicity'
import {
  reconcileEnrollmentCredits,
  getRemainingMonthWindow,
} from '@/features/aulas/creditReconciliation'
import type { Periodicity } from '@/types'

interface StudentSubRow {
  id: string
  organization_id: string
  student_id: string
  plan_id: string
  status: string
  periodicity: string | null
  price: number | null
  current_period_end: string | null
}

async function findStudentSubByPreapproval(preapprovalId: string): Promise<StudentSubRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('student_subscriptions')
    .select('id, organization_id, student_id, plan_id, status, periodicity, price, current_period_end')
    .eq('gateway_subscription_id', preapprovalId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  return (data as StudentSubRow) ?? null
}

// Créditos iniciais da ativação: reconcilia matrículas ativas no restante do
// mês (mesma regra do fluxo manual adminSubscribeStudentToPlan).
async function grantInitialCredits(sub: StudentSubRow): Promise<void> {
  const admin = createAdminClient()
  const { data: enrolls } = await admin
    .from('enrollments')
    .select('class_id')
    .eq('student_id', sub.student_id)
    .eq('organization_id', sub.organization_id)
    .eq('is_active', true)
  const { from, to } = getRemainingMonthWindow(new Date())
  for (const e of (enrolls ?? []) as { class_id: string }[]) {
    await reconcileEnrollmentCredits(sub.student_id, e.class_id, from, to)
  }
}

// subscription_preapproval de assinatura de ALUNO. 'not_found' → o route tenta
// o fluxo de plataforma (SaaS).
export async function handleStudentPreapprovalEvent(
  preapprovalId: string,
): Promise<'handled' | 'not_found'> {
  const sub = await findStudentSubByPreapproval(preapprovalId)
  if (!sub) return 'not_found'

  const account = await getMpAccount(sub.organization_id)
  if (!account) {
    console.error('[webhook/mp] academia sem conta MP para assinatura', { sub: sub.id })
    Sentry.captureMessage('webhook/mp: academia sem conta MP para assinatura', {
      level: 'error',
      extra: { sub: sub.id },
    })
    return 'handled'
  }

  const pre = await mpGetPreapproval(account.accessToken, preapprovalId)
  const mapped = mapStudentPreapprovalStatus(pre.status)
  if (!mapped || mapped === sub.status) return 'handled'

  const admin = createAdminClient()
  if (mapped === 'active') {
    const firstActivation = sub.status === 'pending_payment'
    // current_period_end NÃO é setado aqui — é responsabilidade exclusiva de
    // handleStudentRecurringPayment (a cobrança real). Setar aqui também
    // causava um bug determinístico: a primeira cobrança do MP chega ~1h
    // após a autorização, e handleStudentRecurringPayment sempre AVANÇA a
    // partir do current_period_end vigente — se este handler já tivesse
    // setado um período "grátis" na ativação, o aluno ganhava um período
    // extra silenciosamente em toda assinatura nova.
    await admin
      .from('student_subscriptions')
      .update({ status: 'active' })
      .eq('id', sub.id)

    if (firstActivation) {
      await grantInitialCredits(sub)
      // Indicação do admin atendida.
      await admin
        .from('plan_recommendations')
        .update({ status: 'completed' })
        .eq('student_id', sub.student_id)
        .eq('organization_id', sub.organization_id)
        .eq('plan_id', sub.plan_id)
        .eq('status', 'pending')
    }
  } else if (mapped === 'past_due' || mapped === 'cancelled') {
    await admin.from('student_subscriptions').update({ status: mapped }).eq('id', sub.id)
  }
  // pending_payment: estado inicial, nada a fazer.

  return 'handled'
}

// subscription_authorized_payment (cobrança do período aprovada) para
// assinaturas de aluno. Exige orgId (vem do ?org= da notification_url).
export async function handleStudentRecurringPayment(
  resourceId: string,
  orgId: string,
): Promise<void> {
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] cobrança recorrente sem conta MP', { orgId })
    Sentry.captureMessage('webhook/mp: cobrança recorrente sem conta MP', {
      level: 'error',
      extra: { orgId },
    })
    return
  }

  const ap = await mpGetAuthorizedPayment(account.accessToken, resourceId)
  const approved = ap.payment?.status === 'approved' || ap.status === 'approved'
  if (!approved || !ap.preapproval_id) return

  const sub = await findStudentSubByPreapproval(ap.preapproval_id)
  if (!sub || sub.organization_id !== orgId) return

  const admin = createAdminClient()
  const gatewayPaymentId = String(ap.payment?.id ?? resourceId)

  // Avança o período pago: a partir do fim vigente (se futuro) ou de agora.
  const periodicity = (sub.periodicity ?? 'monthly') as Periodicity
  const base =
    sub.current_period_end && new Date(sub.current_period_end) > new Date()
      ? new Date(sub.current_period_end)
      : new Date()
  const nextEnd = addPeriod(base, periodicity).toISOString()

  // Insert do pagamento + avanço do período na MESMA transação (RPC) — as
  // duas escritas eram chamadas separadas antes; se a segunda falhasse (ou o
  // processo caísse entre as duas), o pagamento ficava "pago" mas o período
  // nunca avançava, e uma reentrega do MP (mesmo gateway_payment_id) batia no
  // unique index e retornava sem tentar de novo. A RPC garante tudo ou nada.
  const { data: processed, error: rpcErr } = await admin.rpc('record_student_subscription_payment', {
    p_subscription_id: sub.id,
    p_organization_id: orgId,
    p_student_id: sub.student_id,
    p_amount: sub.price ?? 0,
    p_gateway_payment_id: gatewayPaymentId,
    p_next_period_end: nextEnd,
  })
  if (rpcErr) {
    throw new Error(`[webhook/mp] record_student_subscription_payment falhou: ${rpcErr.message}`)
  }
  if (!processed) {
    // false = reentrega do MP (gateway_payment_id já processado) — período já
    // avançou na entrega original, nada a fazer.
    return
  }
}
