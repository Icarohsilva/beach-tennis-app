// lib/torneios/entrySide.ts
// Uma inscrição de dupla fixa é dois lados que devem, cada um, a sua parte.
// A partir de partner_payment_status (migração 20260826000400), "quanto esta
// pessoa deve" depende de qual lado da linha ela é — copiar os campos do
// titular no lugar dos do parceiro é o erro previsível que este módulo existe
// para impedir.
export type EntrySide = 'player' | 'partner'
export type PaymentStatus = 'free' | 'pending' | 'paid'

export interface PayableEntry {
  player_id: string
  partner_id: string | null
  payment_status: PaymentStatus
  discount_pct: number
  final_price_cents: number
  receipt_url: string | null
  partner_payment_status: PaymentStatus | null
  partner_discount_pct: number
  partner_final_price_cents: number
  partner_receipt_url: string | null
}

export interface SideCharge {
  paymentStatus: PaymentStatus | null
  discountPct: number
  finalPriceCents: number
  receiptUrl: string | null
}

export function sideOfEntry(
  userId: string,
  e: Pick<PayableEntry, 'player_id' | 'partner_id'>,
): EntrySide | null {
  if (userId === e.player_id) return 'player'
  if (e.partner_id && userId === e.partner_id) return 'partner'
  return null
}

export function chargeFor(side: EntrySide, e: PayableEntry): SideCharge {
  if (side === 'player') {
    return {
      paymentStatus: e.payment_status,
      discountPct: e.discount_pct,
      finalPriceCents: e.final_price_cents,
      receiptUrl: e.receipt_url,
    }
  }
  return {
    paymentStatus: e.partner_payment_status,
    discountPct: e.partner_discount_pct,
    finalPriceCents: e.partner_final_price_cents,
    receiptUrl: e.partner_receipt_url,
  }
}

/** O que a linha ainda deve, somando os dois lados. */
export function entryOwedCents(e: PayableEntry): number {
  let owed = e.payment_status === 'pending' ? e.final_price_cents : 0
  if (e.partner_id && e.partner_payment_status === 'pending') {
    owed += e.partner_final_price_cents
  }
  return owed
}

/** O que a linha já pagou, somando os dois lados. */
export function entryPaidCents(e: PayableEntry): number {
  let paid = e.payment_status === 'paid' ? e.final_price_cents : 0
  if (e.partner_id && e.partner_payment_status === 'paid') {
    paid += e.partner_final_price_cents
  }
  return paid
}

/**
 * Estado geral da linha para o painel do admin. 'partial' é o estado que hoje
 * é invisível — o admin vê "pending" ou "paid" sem saber que só metade da
 * dupla pagou.
 */
export function entryPaymentSummary(e: PayableEntry): PaymentStatus | 'partial' {
  if (!e.partner_id) return e.payment_status

  // Linha legada (partner_payment_status nulo): nunca foi cobrada em dupla —
  // o estado geral é o do titular, sem inventar uma dívida do parceiro que
  // nunca existiu.
  if (e.partner_payment_status === null) return e.payment_status

  if (e.payment_status === e.partner_payment_status) return e.payment_status
  return 'partial'
}
