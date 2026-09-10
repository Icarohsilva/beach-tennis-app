// features/dayuse/adminSlotQuery.ts
// Tudo o que o admin precisa saber sobre UM day use: quem está dentro, quem
// pagou, o comprovante de cada um e — para quem cancelou — a chave PIX do
// estorno.
//
// Uma consulta só porque a tela é uma só. Antes disso o admin não tinha como
// saber quem estava inscrito num day use: a lista mostrava apenas a contagem.
import type { createAdminClient } from '@/lib/supabase/server'
import type { DayUseSlot } from '@/types'
import type { DayUsePaymentMethod } from '@/lib/dayuse/paymentMethod'
import type { RefundMethod, RefundStatus } from '@/lib/dayuse/refundRules'

type AdminClient = ReturnType<typeof createAdminClient>

export interface AdminAttendee {
  bookingId: string
  studentId: string
  name: string
  phone: string | null
  status: 'confirmed' | 'pending_payment' | 'cancelled'
  paymentMethod: DayUsePaymentMethod
  bookedAt: string
  holdUntil: string | null
  /** Pagamento ligado à reserva, quando há cobrança. */
  payment: { amountCents: number; status: string } | null
  /** URL assinada do comprovante do PIX manual (bucket privado). */
  receiptSignedUrl: string | null
  hasReceipt: boolean
  /** Chave PIX que o aluno deixou para estorno. */
  refundPixKey: string | null
  refundPixOwner: string | null
  /** Estorno aberto para esta reserva, quando existe. */
  refund: {
    id: string
    amountCents: number
    method: RefundMethod
    status: RefundStatus
    pixKey: string | null
    pixOwner: string | null
  } | null
}

export interface AdminDayUse {
  slot: DayUseSlot
  attendees: AdminAttendee[]
  /** Ocupação: confirmados + pendentes ainda no prazo. */
  occupied: number
}

export async function getAdminDayUse(
  client: AdminClient,
  input: { slotId: string; orgId: string },
): Promise<AdminDayUse | null> {
  const { data: slotRaw } = await client
    .from('dayuse_slots')
    .select('*')
    .eq('id', input.slotId)
    .eq('organization_id', input.orgId)
    .maybeSingle()
  if (!slotRaw) return null
  const slot = slotRaw as DayUseSlot

  // Teto natural (a capacidade de um horário mais os cancelados dele), então
  // `.select()` direto. Cancelado ENTRA na lista: o admin precisa ver quem saiu
  // para saber a quem deve estorno — some da contagem, não da tela.
  const { data: rows } = await client
    .from('dayuse_bookings')
    .select(`
      id, student_id, status, payment_method, booked_at, hold_until,
      receipt_url, refund_pix_key, refund_pix_owner,
      profiles(full_name, phone),
      payments(amount, status),
      dayuse_refunds(id, amount_cents, method, status, pix_key, pix_owner)
    `)
    .eq('slot_id', input.slotId)
    .order('booked_at', { ascending: true })

  type Row = {
    id: string
    student_id: string
    status: AdminAttendee['status']
    payment_method: DayUsePaymentMethod
    booked_at: string
    hold_until: string | null
    receipt_url: string | null
    refund_pix_key: string | null
    refund_pix_owner: string | null
    profiles: { full_name: string; phone: string | null } | { full_name: string; phone: string | null }[] | null
    payments: { amount: number; status: string }[] | null
    dayuse_refunds:
      | AdminAttendee['refund'][]
      | { id: string; amount_cents: number; method: RefundMethod; status: RefundStatus; pix_key: string | null; pix_owner: string | null }
      | null
  }

  const attendees: AdminAttendee[] = []
  const now = Date.now()
  let occupied = 0

  for (const r of (rows ?? []) as unknown as Row[]) {
    const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    // Pagamento que interessa é o que não falhou; `failed` é tentativa morta.
    const payment = (r.payments ?? []).find((p) => p.status !== 'failed') ?? null
    const refundRaw = Array.isArray(r.dayuse_refunds) ? r.dayuse_refunds[0] : r.dayuse_refunds
    const refund = refundRaw as {
      id: string; amount_cents: number; method: RefundMethod; status: RefundStatus
      pix_key: string | null; pix_owner: string | null
    } | null

    let receiptSignedUrl: string | null = null
    if (r.receipt_url) {
      const { data: signed } = await client.storage
        .from('payment-receipts')
        .createSignedUrl(r.receipt_url, 60 * 10)
      receiptSignedUrl = signed?.signedUrl ?? null
    }

    const holdValid = r.hold_until ? new Date(r.hold_until).getTime() > now : false
    if (r.status === 'confirmed' || (r.status === 'pending_payment' && holdValid)) occupied++

    attendees.push({
      bookingId: r.id,
      studentId: r.student_id,
      name: prof?.full_name ?? 'Aluno',
      phone: prof?.phone ?? null,
      status: r.status,
      paymentMethod: r.payment_method,
      bookedAt: r.booked_at,
      holdUntil: r.hold_until,
      payment: payment
        ? { amountCents: Math.round(Number(payment.amount) * 100), status: payment.status }
        : null,
      receiptSignedUrl,
      hasReceipt: Boolean(r.receipt_url),
      refundPixKey: r.refund_pix_key,
      refundPixOwner: r.refund_pix_owner,
      refund: refund
        ? {
            id: refund.id,
            amountCents: refund.amount_cents,
            method: refund.method,
            status: refund.status,
            pixKey: refund.pix_key,
            pixOwner: refund.pix_owner,
          }
        : null,
    })
  }

  // Ativos primeiro: cancelado é histórico, e é o ativo que a arena confere na
  // hora de abrir a quadra.
  attendees.sort((a, b) => Number(a.status === 'cancelled') - Number(b.status === 'cancelled'))

  return { slot, attendees, occupied }
}
