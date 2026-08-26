// app/api/webhooks/mercadopago/checkoutHandlers.ts
// Pagamentos de Checkout Pro (aula avulsa / day use) das academias. A
// notificação chega com ?org=<id> (notification_url da preferência) e é
// tratada como GATILHO NÃO CONFIÁVEL: nada acontece sem re-consultar o
// pagamento na API do MP com o token da academia. O external_reference do
// pagamento aponta para a NOSSA linha de payments (criada pending no checkout).
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
import { getMpAccount } from '@/lib/billing/gatewayAccounts'
import { mpGetPayment } from '@/lib/billing/mpClient'

interface PaymentRow {
  id: string
  organization_id: string
  student_id: string
  status: string
  type: string
  amount: number
  credits_qty: number | null
  dayuse_booking_id: string | null
  session_id: string | null
  tournament_entry_id: string | null
}

export async function handleOrgCheckoutPayment(
  mpPaymentId: string,
  orgId: string,
): Promise<void> {
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] checkout sem conta MP', { orgId })
    Sentry.captureMessage('webhook/mp: checkout sem conta MP', {
      level: 'error',
      extra: { orgId },
    })
    return
  }

  const mpPay = await mpGetPayment(account.accessToken, mpPaymentId)
  if (mpPay.status !== 'approved') return
  const ref = mpPay.external_reference
  if (!ref) return

  const admin = createAdminClient()
  const { data: payRaw } = await admin
    .from('payments')
    .select('id, organization_id, student_id, status, type, amount, credits_qty, dayuse_booking_id, session_id, tournament_entry_id')
    .eq('id', ref)
    .eq('organization_id', orgId)
    .maybeSingle()
  const pay = payRaw as PaymentRow | null
  if (!pay || pay.status === 'paid') return

  // Valor não pode ser MENOR que o esperado (ref reaproveitada). Maior é
  // tolerado: cartão parcelado com juros faz o transaction_amount aprovado
  // exceder legitimamente o valor cobrado — rejeitar por excesso deixaria um
  // pagamento genuinamente aprovado preso em 'pending' para sempre.
  if (
    mpPay.transaction_amount != null &&
    Number(mpPay.transaction_amount) < Number(pay.amount) - 0.01
  ) {
    console.error('[webhook/mp] valor menor que o esperado', {
      payment: pay.id, esperado: pay.amount, recebido: mpPay.transaction_amount,
    })
    Sentry.captureMessage('webhook/mp: valor menor que o esperado', {
      level: 'error',
      extra: { payment: pay.id, esperado: pay.amount, recebido: mpPay.transaction_amount },
    })
    return
  }

  const gatewayPaymentId = String(mpPay.id)

  // Quitação de DÍVIDA de aula (session_id não nulo) — distinta da COMPRA de
  // créditos, que também é type='per_class' mas tem session_id null e
  // credits_qty preenchido. Aqui NÃO se concede crédito: o aluno está pagando
  // uma aula que já assistiu. Usar o record_checkout_credit_purchase daqui
  // daria crédito que ele não comprou.
  if (pay.type === 'per_class' && pay.session_id) {
    const { error: updErr } = await admin
      .from('payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        gateway_payment_id: gatewayPaymentId,
        settled_method: 'mercadopago',
      })
      .eq('id', pay.id)
      .eq('status', 'pending') // idempotente: reentrega do MP não reescreve
    if (updErr) {
      throw new Error(`[webhook/mp] baixa de divida falhou: ${updErr.message}`)
    }
    return
  }

  if (pay.type === 'per_class') {
    // Marca paid + concede crédito (não expira, spec §3.4) na MESMA
    // transação (RPC) — as duas escritas eram chamadas separadas antes; se a
    // segunda falhasse (ou o processo caísse entre as duas), o pagamento
    // ficava "pago" para sempre sem crédito nenhum, e uma reentrega do MP
    // batia no status='paid' já setado e retornava sem tentar de novo.
    // Retorno (true = aplicado agora, false = reentrega já processada) não
    // muda a ação daqui — em ambos os casos não há mais nada a fazer.
    const { error: rpcErr } = await admin.rpc('record_checkout_credit_purchase', {
      p_payment_id: pay.id,
      p_gateway_payment_id: gatewayPaymentId,
    })
    if (rpcErr) {
      throw new Error(`[webhook/mp] record_checkout_credit_purchase falhou: ${rpcErr.message}`)
    }
    return
  }

  if (pay.type === 'day_use' && pay.dayuse_booking_id) {
    // Atômico (RPC record_dayuse_checkout_payment): marca o pagamento pago E
    // confirma/cancela a reserva conforme o prazo de 30min, na mesma
    // transação — mesma razão do record_checkout_credit_purchase acima.
    const { error: rpcErr } = await admin.rpc('record_dayuse_checkout_payment', {
      p_payment_id: pay.id,
      p_gateway_payment_id: gatewayPaymentId,
    })
    if (rpcErr) {
      throw new Error(`[webhook/mp] record_dayuse_checkout_payment falhou: ${rpcErr.message}`)
    }
    return
  }

  if (pay.type === 'tournament_entry' && pay.tournament_entry_id) {
    // Atômico (RPC record_tournament_entry_checkout_payment): marca o
    // pagamento pago E o lado certo (titular/parceiro) da inscrição na mesma
    // transação — a dupla fixa é cobrada por atleta (Fase 2a), então dar
    // baixa sem saber o lado sobrescreveria a metade errada da dupla.
    const { error: rpcErr } = await admin.rpc('record_tournament_entry_checkout_payment', {
      p_payment_id: pay.id,
      p_gateway_payment_id: gatewayPaymentId,
    })
    if (rpcErr) {
      throw new Error(`[webhook/mp] record_tournament_entry_checkout_payment falhou: ${rpcErr.message}`)
    }
  }
}
