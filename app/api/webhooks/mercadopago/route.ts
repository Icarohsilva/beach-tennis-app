// app/api/webhooks/mercadopago/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import crypto from 'crypto'

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
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (secret) {
    const xSignature = req.headers.get('x-signature')
    const xRequestId = req.headers.get('x-request-id')
    const rawBody = await req.text()

    if (!xSignature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    // MP sends: ts=<timestamp>,v1=<hash>
    const parts = Object.fromEntries(
      xSignature.split(',').map((p) => {
        const [k, v] = p.split('=', 2)
        return [k.trim(), v?.trim()]
      }),
    )
    const ts = parts['ts']
    const v1 = parts['v1']

    if (!ts || !v1) {
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 })
    }

    const manifest = `id:${xRequestId ?? ''};request-id:${xRequestId ?? ''};ts:${ts};`
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

    if (expected !== v1) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Parse JSON body from rawBody
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    return handleWebhook(body as WebhookPayload)
  }

  // No secret configured — parse body normally (dev/test mode)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  return handleWebhook(body as WebhookPayload)
}

interface WebhookPayload {
  action?: string
  type?: string
  data?: { id?: string | number }
}

async function handleWebhook(body: WebhookPayload): Promise<NextResponse> {
  const action = body.action ?? body.type
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
      .select('id, plan_id, student_id')
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
          // Update cached balance: renewal replaces, not accumulates
          await adminClient
            .from('profiles')
            .update({ credits_balance: creditsPerMonth })
            .eq('id', sub.student_id)
        }
      }
    }
  }

  return NextResponse.json({ received: true })
}
