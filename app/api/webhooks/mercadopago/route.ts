// app/api/webhooks/mercadopago/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { mapPreapprovalStatus } from '@/lib/billing/mpStatus'
import { isValidSignature } from '@/lib/billing/webhookSignature'
import {
  handleStudentPreapprovalEvent,
  handleStudentRecurringPayment,
} from './studentHandlers'
import { handleOrgCheckoutPayment } from './checkoutHandlers'

/**
 * Mercado Pago webhook handler.
 *
 * Security: validates x-signature header using HMAC-SHA256 with MERCADOPAGO_WEBHOOK_SECRET.
 *
 * On payment.updated / payment.created with status = 'approved':
 *   1. Find the matching payment row by gateway_payment_id
 *   2. Update payments.status = 'paid' and paid_at = now
 *   3. Find the student_subscription linked to that payment
 *   4. Fetch subscription_plans.credits_per_month for the plan
 *   5. Insert credit_transactions.type = 'renewed' with amount = credits_per_month
 *   6. Update profiles.credits_balance = credits_per_month (renewal, not accumulation)
 */
export async function POST(req: NextRequest) {
  // ─── Signature validation ───────────────────────────────────────────────
  // Fail-closed (auditoria #4): sem o secret configurado NÃO processamos o
  // webhook. Caso contrário qualquer requisição não autenticada marcaria
  // pagamentos como pagos e concederia créditos.
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook/mercadopago] MERCADOPAGO_WEBHOOK_SECRET ausente — recusando webhook')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 })
  }

  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')
  // O MP calcula a assinatura sobre o data.id que vem na QUERY STRING da URL
  // de notificação (não sobre o corpo). Ver lib/billing/webhookSignature.ts.
  const dataId = req.nextUrl.searchParams.get('data.id')
  const rawBody = await req.text()

  // ?org= identifica a academia dona da notificação de assinatura de ALUNO
  // (Checkout Pro/preapproval criado com notification_url contendo ?org=).
  // Essas notificações não carregam HMAC — a segurança vem inteiramente de
  // re-confirmar na API do MP com o token da própria academia no handler,
  // nunca deste parâmetro ou do corpo da requisição.
  const orgParam = req.nextUrl.searchParams.get('org')
  const signatureOk = isValidSignature({ xSignature, requestId: xRequestId, dataId, secret })
  if (!signatureOk && !orgParam) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (!signatureOk && orgParam) {
    console.warn('[webhook/mercadopago] notificação ?org= sem assinatura válida — seguindo como gatilho não confiável')
  }

  // Parse JSON body from rawBody
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  return handleWebhook(body as WebhookPayload, orgParam)
}

/**
 * Confirma na API do MP que o pagamento está realmente aprovado (auditoria #4).
 * Retorna:
 *   true  → status === 'approved' (pode creditar)
 *   false → qualquer outro status (recusado/estornado/pendente → NÃO creditar)
 *   null  → não foi possível confirmar (token ausente ou erro na API)
 */
async function isMpPaymentApproved(paymentId: string): Promise<boolean | null> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) {
    console.error('[webhook/mercadopago] MERCADOPAGO_ACCESS_TOKEN ausente — não dá para confirmar status do pagamento')
    return null
  }
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[webhook/mercadopago] GET payment falhou:', res.status)
    return null
  }
  const pay = (await res.json()) as { status?: string }
  return pay.status === 'approved'
}

interface WebhookPayload {
  action?: string
  type?: string
  data?: { id?: string | number }
}

async function handleWebhook(body: WebhookPayload, orgParam: string | null): Promise<NextResponse> {
  const action = body.action ?? body.type
  const resourceId = String(body.data?.id ?? '')

  try {
    // Assinaturas: primeiro tenta ALUNO (billing aluno→academia, lookup por
    // preapproval id); se não for, cai no fluxo de PLATAFORMA (SaaS
    // academia→plataforma) já existente, que segue abaixo intocado.
    if (action === 'subscription_preapproval') {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      const result = await handleStudentPreapprovalEvent(resourceId)
      if (result === 'handled') return NextResponse.json({ received: true })
      return handlePlatformSubscription(action, resourceId)
    }

    if (action === 'subscription_authorized_payment') {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      if (orgParam) {
        await handleStudentRecurringPayment(resourceId, orgParam)
        return NextResponse.json({ received: true })
      }
      return handlePlatformSubscription(action, resourceId)
    }

    // Checkout Pro das academias (aula avulsa / day use): notificação com ?org=.
    if (orgParam && action && action.startsWith('payment')) {
      if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
      await handleOrgCheckoutPayment(resourceId, orgParam)
      return NextResponse.json({ received: true })
    }
  } catch (e) {
    // Falha transitória (API MP fora, DB): 500 → MP reentrega o evento.
    console.error('[webhook/mercadopago] handler falhou', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  const gatewayPaymentId = String(body.data?.id ?? '')

  // Only handle payment events
  if (!action || (!action.startsWith('payment') && action !== 'payment.updated')) {
    return NextResponse.json({ received: true })
  }

  if (!gatewayPaymentId) {
    return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Find payment row
  const { data: payment, error: paymentErr } = await adminClient
    .from('payments')
    .select('id, student_id, subscription_id, status, amount, currency')
    .eq('gateway_payment_id', gatewayPaymentId)
    .maybeSingle()

  if (paymentErr) {
    console.error('[webhook/mercadopago] DB error fetching payment:', paymentErr)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!payment) {
    // Payment not in our DB — ignore (could be from another integration)
    return NextResponse.json({ received: true })
  }

  // Only process if not already paid
  if (payment.status === 'paid') {
    return NextResponse.json({ received: true })
  }

  // Confirma na API do MP que o pagamento está aprovado ANTES de marcar como
  // pago e conceder créditos (auditoria #4). Evento de pagamento recusado/
  // estornado/pendente não credita. Sem confirmação → não processa (o MP
  // reentrega o evento depois).
  const approved = await isMpPaymentApproved(gatewayPaymentId)
  if (approved !== true) {
    return NextResponse.json({ received: true })
  }

  const now = new Date().toISOString()

  // Update payment to paid
  const { error: updatePaymentErr } = await adminClient
    .from('payments')
    .update({ status: 'paid', paid_at: now })
    .eq('id', payment.id)

  if (updatePaymentErr) {
    console.error('[webhook/mercadopago] Error updating payment:', updatePaymentErr)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }

  // If this payment is linked to a subscription, release monthly credits
  if (payment.subscription_id) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('id, plan_id, student_id, organization_id')
      .eq('id', payment.subscription_id)
      .maybeSingle()

    if (sub) {
      const { data: plan } = await adminClient
        .from('subscription_plans')
        .select('credits_per_month')
        .eq('id', sub.plan_id)
        .maybeSingle()

      const creditsPerMonth = plan?.credits_per_month ?? 0

      if (creditsPerMonth > 0) {
        // Insert renewed transaction
        const { error: txErr } = await adminClient.from('credit_transactions').insert({
          student_id: sub.student_id,
          organization_id: sub.organization_id,
          type: 'renewed',
          amount: creditsPerMonth,
          reason: `Renovação mensal — pagamento ${gatewayPaymentId}`,
          session_id: null,
          subscription_id: sub.id,
          expires_at: null,
        })

        if (txErr) {
          console.error('[webhook/mercadopago] Error inserting credit_transaction:', txErr)
          // Payment was already marked paid — don't fail the whole webhook
        } else {
          // Update cached balance: renewal replaces, not accumulates.
          // Saldo é por-academia → grava na membership da (aluno, org da assinatura).
          await adminClient
            .from('memberships')
            .update({ credits_balance: creditsPerMonth })
            .eq('user_id', sub.student_id)
            .eq('organization_id', sub.organization_id)
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}

// Sincroniza platform_subscriptions a partir de eventos de assinatura do MercadoPago.
// - subscription_preapproval: mudança de status da assinatura (id = preapproval id).
// - subscription_authorized_payment: cobrança mensal aprovada → empurra current_period_end.
async function handlePlatformSubscription(
  action: string,
  resourceId: string,
): Promise<NextResponse> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) {
    console.error('[webhook/mercadopago] MERCADOPAGO_ACCESS_TOKEN ausente')
    return NextResponse.json({ received: true })
  }
  if (!resourceId) return NextResponse.json({ error: 'Missing data.id' }, { status: 400 })

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  if (action === 'subscription_preapproval') {
    // Lê a assinatura no MP: status + external_reference (= organization_id).
    const res = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      console.error('[webhook/mercadopago] GET preapproval falhou:', res.status)
      return NextResponse.json({ received: true })
    }
    const pre = (await res.json()) as { status?: string; external_reference?: string }
    const mapped = mapPreapprovalStatus(pre.status)
    if (!mapped || !pre.external_reference) return NextResponse.json({ received: true })

    await admin
      .from('platform_subscriptions')
      .update({ status: mapped, mp_preapproval_id: resourceId, updated_at: nowIso })
      .eq('organization_id', pre.external_reference)

    return NextResponse.json({ received: true })
  }

  // subscription_authorized_payment: cobrança mensal aprovada.
  // O id do evento é do pagamento; encontramos a org pela assinatura associada.
  const res = await fetch(`https://api.mercadopago.com/authorized_payments/${resourceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    console.error('[webhook/mercadopago] GET authorized_payment falhou:', res.status)
    return NextResponse.json({ received: true })
  }
  const pay = (await res.json()) as { preapproval_id?: string; status?: string }
  if (pay.status !== 'approved' || !pay.preapproval_id) {
    return NextResponse.json({ received: true })
  }

  // Empurra o período pago em +1 mês a partir de agora e marca ativa. Idempotente o
  // suficiente para o smoke test (reprocessar empurra o período de novo; aceitável).
  const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString()
  await admin
    .from('platform_subscriptions')
    .update({ status: 'active', current_period_end: periodEnd, updated_at: nowIso })
    .eq('mp_preapproval_id', pay.preapproval_id)

  return NextResponse.json({ received: true })
}
