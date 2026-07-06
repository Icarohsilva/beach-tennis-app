// app/api/webhooks/mercadopago/checkoutHandlers.ts
// Pagamentos de Checkout Pro (aula avulsa / day use) das academias. A
// notificação chega com ?org=<id> (notification_url da preferência) e é
// tratada como GATILHO NÃO CONFIÁVEL: nada acontece sem re-consultar o
// pagamento na API do MP com o token da academia. O external_reference do
// pagamento aponta para a NOSSA linha de payments (criada pending no checkout).
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
}

export async function handleOrgCheckoutPayment(
  mpPaymentId: string,
  orgId: string,
): Promise<void> {
  const account = await getMpAccount(orgId)
  if (!account) {
    console.error('[webhook/mp] checkout sem conta MP', { orgId })
    return
  }

  const mpPay = await mpGetPayment(account.accessToken, mpPaymentId)
  if (mpPay.status !== 'approved') return
  const ref = mpPay.external_reference
  if (!ref) return

  const admin = createAdminClient()
  const { data: payRaw } = await admin
    .from('payments')
    .select('id, organization_id, student_id, status, type, amount, credits_qty, dayuse_booking_id')
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
    return
  }

  const gatewayPaymentId = String(mpPay.id)

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
    // ATENÇÃO: ainda não é caminho vivo hoje (nenhum código cria payment
    // type='day_use') — nenhuma reserva de day use é criada por este task.
    // Quando a task de day use pago ligar este fluxo, o mesmo problema de
    // atomicidade do per_class se aplica aqui (marcar paid + confirmar booking
    // são hoje duas escritas separadas) — precisa da mesma RPC atômica antes
    // de virar um caminho real.
    const { data: updated } = await admin
      .from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), gateway_payment_id: gatewayPaymentId })
      .eq('id', pay.id)
      .eq('status', 'pending')
      .select('id')
    if (!updated || updated.length === 0) return
    await confirmDayUseBooking(pay.dayuse_booking_id)
  }
}

// Confirma o booking de day use SE ainda estiver pendente dentro do prazo de
// 30 min. Fora do prazo: booking fica/vira cancelado e o pagamento pago
// aparece como "reembolso pendente" no financeiro do admin (spec §3.5).
async function confirmDayUseBooking(bookingId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: booking } = await admin
    .from('dayuse_bookings')
    .select('id, status, booked_at')
    .eq('id', bookingId)
    .maybeSingle()
  if (!booking) return

  const freshLimit = Date.now() - 30 * 60 * 1000
  const isFreshPending =
    booking.status === 'pending_payment' &&
    new Date(booking.booked_at as string).getTime() > freshLimit

  if (isFreshPending) {
    await admin
      .from('dayuse_bookings')
      .update({ status: 'confirmed' })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')
  } else if (booking.status === 'pending_payment') {
    // Pagou tarde demais: a vaga já pode ter sido retomada.
    await admin
      .from('dayuse_bookings')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('status', 'pending_payment')
  }
}
