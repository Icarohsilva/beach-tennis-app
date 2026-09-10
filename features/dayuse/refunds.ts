// features/dayuse/refunds.ts
// A coleta de dados do estorno de day use e a abertura dele. Módulo comum (sem
// 'use server') porque quem abre estorno são dois caminhos diferentes: a arena
// cancelando o horário (features/dayuse/cancelSlot.ts) e o aluno cancelando a
// própria reserva (features/dayuse/actions.ts). A regra em si é pura, em
// lib/dayuse/refundRules.ts.
import type { createAdminClient } from '@/lib/supabase/server'
import {
  resolveRefundEligibility,
  type RefundCause,
  type RefundEligibility,
} from '@/lib/dayuse/refundRules'
import { CANCELLATION_WINDOW_HOURS } from '@/lib/utils/creditRules'
import { WALLET_REASONS } from '@/lib/wallet/wallet'
import { creditWallet } from '@/features/wallet/spendWallet'

type AdminClient = ReturnType<typeof createAdminClient>

/** Janela de estorno da academia, em horas. Default = a da aula (5h). */
export async function getRefundWindowHours(client: AdminClient, orgId: string): Promise<number> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', 'dayuse_refund_window_hours')
    .maybeSingle()
  const n = Number((data as { value: string } | null)?.value)
  return Number.isFinite(n) && n >= 0 ? n : CANCELLATION_WINDOW_HOURS
}

export interface BookingPayment {
  /** Centavos que entraram por gateway (payments com status 'paid'). */
  gatewayCents: number
  /** Centavos debitados da carteira nesta reserva. */
  walletCents: number
}

/**
 * O que esta reserva efetivamente pagou.
 *
 * Duas origens somadas porque uma reserva pode ser mista (saldo cobre parte, o
 * resto vai ao cartão) e cada parte volta pelo caminho de onde veio.
 *
 * Só `status = 'paid'`: pagamento pendente que nunca confirmou não é dinheiro na
 * mão da academia, e estornar o que não entrou é pagar duas vezes.
 */
export async function getBookingPayment(
  client: AdminClient,
  bookingId: string,
): Promise<BookingPayment> {
  const [{ data: payRows }, { data: walletRows }] = await Promise.all([
    client
      .from('payments')
      .select('amount')
      .eq('dayuse_booking_id', bookingId)
      .eq('status', 'paid'),
    client
      .from('wallet_transactions')
      .select('amount_cents')
      .eq('source_table', 'dayuse_bookings')
      .eq('source_id', bookingId)
      .eq('reason', WALLET_REASONS.dayuseBooking),
  ])

  const gatewayCents = ((payRows ?? []) as { amount: number }[]).reduce(
    (sum, p) => sum + Math.round(Number(p.amount) * 100),
    0,
  )
  // O lançamento da carteira é negativo (gasto); o que voltar é o valor absoluto.
  const walletCents = ((walletRows ?? []) as { amount_cents: number }[]).reduce(
    (sum, w) => sum + Math.abs(Number(w.amount_cents)),
    0,
  )

  return { gatewayCents, walletCents }
}

export interface OpenRefundInput {
  orgId: string
  bookingId: string
  studentId: string
  slot: { date: string; start_time: string }
  bookedAtIso: string | null
  cause: RefundCause
  /** Chave PIX informada na reserva, se houver. */
  pixKey?: string | null
  pixOwner?: string | null
  nowIso?: string
}

export interface OpenRefundResult {
  eligibility: RefundEligibility
  /** Id do estorno aberto (ou o já existente). Null quando não há estorno. */
  refundId: string | null
  /** Centavos devolvidos direto para a carteira nesta chamada. */
  walletRestoredCents: number
}

/**
 * Abre o estorno devido por um cancelamento — se for devido.
 *
 * Idempotente pelo índice único de `dayuse_refunds.booking_id`: chamada duas
 * vezes para a mesma reserva (retry, duplo clique, cancelamento em massa
 * repetido) devolve o estorno que já existe em vez de criar o segundo. A parte
 * paga com carteira volta na hora, e essa devolução é idempotente pelo índice
 * de origem de `wallet_transactions`.
 */
export async function openRefundForBooking(
  client: AdminClient,
  input: OpenRefundInput,
): Promise<OpenRefundResult> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const [paid, windowHours] = await Promise.all([
    getBookingPayment(client, input.bookingId),
    getRefundWindowHours(client, input.orgId),
  ])

  const eligibility = resolveRefundEligibility({
    date: input.slot.date,
    start_time: input.slot.start_time,
    bookedAtIso: input.bookedAtIso,
    nowIso,
    gatewayCents: paid.gatewayCents,
    walletCents: paid.walletCents,
    cause: input.cause,
    windowHours,
  })

  let walletRestoredCents = 0
  if (eligibility.walletRestoreCents > 0) {
    const r = await creditWallet(client, {
      orgId: input.orgId,
      studentId: input.studentId,
      cents: eligibility.walletRestoreCents,
      reason: WALLET_REASONS.dayuseRefund,
      sourceTable: 'dayuse_bookings',
      sourceId: input.bookingId,
    })
    // Best-effort e barulhento: a devolução do saldo não pode derrubar o
    // cancelamento (a vaga já foi liberada), mas sumir com dinheiro em silêncio
    // é pior que log nenhum.
    if (r.error) {
      console.error('[dayuse/refund] devolução para a carteira falhou', {
        bookingId: input.bookingId, error: r.error,
      })
    } else {
      walletRestoredCents = eligibility.walletRestoreCents
    }
  }

  if (!eligibility.due) {
    return { eligibility, refundId: null, walletRestoredCents }
  }

  const { data: created, error } = await client
    .from('dayuse_refunds')
    .insert({
      organization_id: input.orgId,
      booking_id: input.bookingId,
      student_id: input.studentId,
      amount_cents: eligibility.amountCents,
      cause: input.cause,
      method: 'pix',
      pix_key: input.pixKey || null,
      pix_owner: input.pixOwner || null,
      status: 'pendente',
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation em booking_id: o estorno já existe. Devolve o
    // que está lá em vez de tratar reentrada como falha.
    const { data: existing } = await client
      .from('dayuse_refunds')
      .select('id')
      .eq('booking_id', input.bookingId)
      .maybeSingle()
    if (existing) {
      return { eligibility, refundId: (existing as { id: string }).id, walletRestoredCents }
    }
    console.error('[dayuse/refund] insert de dayuse_refunds falhou', {
      bookingId: input.bookingId, error: error.message,
    })
    return { eligibility, refundId: null, walletRestoredCents }
  }

  return { eligibility, refundId: created.id as string, walletRestoredCents }
}

/** Minutos que uma reserva pendente de pagamento ocupa a vaga. Igual à RPC. */
export const PENDING_HOLD_MINUTES = 30

/**
 * Cancela as reservas pendentes vencidas de uma academia e devolve o saldo que
 * elas tinham debitado.
 *
 * Substitui o update em massa que existia nas páginas de day use. O update
 * bruto liberava a vaga mas deixava o saldo debitado: quem abatia crédito e
 * abandonava o checkout ficava sem a vaga E sem o dinheiro — o único jeito de
 * a carteira "sumir" com valor.
 *
 * `openRefundForBooking` faz o trabalho certo aqui sem precisar de exceção:
 * como o pagamento nunca confirmou, ele calcula gateway = 0, devolve a parte da
 * carteira e não abre estorno nenhum.
 */
export async function expireStalePendingDayUse(
  client: AdminClient,
  orgId: string,
): Promise<{ expired: number; walletRestoredCents: number }> {
  const limit = new Date(Date.now() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString()

  const { data: staleRaw } = await client
    .from('dayuse_bookings')
    .select('id, student_id, booked_at, dayuse_slots(date, start_time)')
    .eq('organization_id', orgId)
    .eq('status', 'pending_payment')
    .lt('booked_at', limit)

  const stale = (staleRaw ?? []) as {
    id: string
    student_id: string
    booked_at: string
    dayuse_slots:
      | { date: string; start_time: string }
      | { date: string; start_time: string }[]
      | null
  }[]
  if (stale.length === 0) return { expired: 0, walletRestoredCents: 0 }

  await client
    .from('dayuse_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .in('id', stale.map((b) => b.id))

  let walletRestoredCents = 0
  for (const b of stale) {
    const slot = Array.isArray(b.dayuse_slots) ? b.dayuse_slots[0] : b.dayuse_slots
    if (!slot) continue
    const r = await openRefundForBooking(client, {
      orgId,
      bookingId: b.id,
      studentId: b.student_id,
      slot,
      bookedAtIso: b.booked_at,
      cause: 'arena_cancelou',
    })
    walletRestoredCents += r.walletRestoredCents
  }

  return { expired: stale.length, walletRestoredCents }
}
