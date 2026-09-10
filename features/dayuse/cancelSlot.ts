// features/dayuse/cancelSlot.ts
// A arena cancelou um horário de day use: encerra as reservas, abre o estorno de
// quem pagou e avisa todo mundo.
//
// Irmão de refundSessionBookings (features/aulas/cancelSessionBookings.ts), que
// faz o mesmo para a aula. Existe porque `deactivateDayUseSlot` só marcava
// `is_active = false`: as reservas continuavam `confirmed`, o horário
// desaparecia da tela do aluno sem aviso nenhum e quem tinha pagado não recebia
// nada de volta. A academia cancelava e o aluno pagava a conta.
import type { createAdminClient } from '@/lib/supabase/server'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { openRefundForBooking } from './refunds'

type AdminClient = ReturnType<typeof createAdminClient>

export interface CancelSlotResult {
  /** Reservas encerradas por este cancelamento. */
  cancelled: number
  /** Estornos abertos (só quem pagou por gateway). */
  refundsOpened: number
  /** Centavos devolvidos direto para a carteira. */
  walletRestoredCents: number
}

/**
 * Encerra as reservas ativas de um horário e abre o que for devido.
 *
 * `cause: 'arena_cancelou'` de propósito: quando é a arena que desmarca, a
 * janela de cancelamento do aluno não se aplica — ele não escolheu nada.
 *
 * O cancelamento das reservas vem ANTES do estorno: a vaga liberada é o efeito
 * que não pode falhar, e o estorno é reentrante (openRefundForBooking é
 * idempotente), então uma falha no meio se conserta rodando de novo.
 */
export async function cancelDayUseSlotBookings(
  client: AdminClient,
  input: { slotId: string; orgId: string },
): Promise<CancelSlotResult> {
  const { data: slotRaw } = await client
    .from('dayuse_slots')
    .select('id, date, start_time, end_time, court')
    .eq('id', input.slotId)
    .eq('organization_id', input.orgId)
    .maybeSingle()
  if (!slotRaw) return { cancelled: 0, refundsOpened: 0, walletRestoredCents: 0 }
  const slot = slotRaw as {
    date: string; start_time: string; end_time: string; court: number
  }

  // Reservas que ainda valem algo. `pending_payment` entra: a vaga precisa ser
  // liberada, e se o pagamento confirmar depois o estorno cobre.
  const { data: bookingsRaw } = await client
    .from('dayuse_bookings')
    .select('id, student_id, booked_at, refund_pix_key, refund_pix_owner')
    .eq('slot_id', input.slotId)
    .in('status', ['confirmed', 'pending_payment'])

  const bookings = (bookingsRaw ?? []) as {
    id: string
    student_id: string
    booked_at: string
    refund_pix_key: string | null
    refund_pix_owner: string | null
  }[]

  if (bookings.length === 0) return { cancelled: 0, refundsOpened: 0, walletRestoredCents: 0 }

  await client
    .from('dayuse_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .in('id', bookings.map((b) => b.id))

  let refundsOpened = 0
  let walletRestoredCents = 0
  const refundedStudentIds = new Set<string>()

  for (const b of bookings) {
    const r = await openRefundForBooking(client, {
      orgId: input.orgId,
      bookingId: b.id,
      studentId: b.student_id,
      slot: { date: slot.date, start_time: slot.start_time },
      bookedAtIso: b.booked_at,
      cause: 'arena_cancelou',
      pixKey: b.refund_pix_key,
      pixOwner: b.refund_pix_owner,
    })
    if (r.refundId) {
      refundsOpened++
      refundedStudentIds.add(b.student_id)
    }
    walletRestoredCents += r.walletRestoredCents
  }

  // Aviso: quem pagou ouve falar do estorno, quem não pagou ouve só o
  // cancelamento. Mandar "seu estorno está a caminho" para quem entrou de graça
  // gera cobrança de dinheiro que não existe.
  const quando = `${formatDate(slot.date, "EEEE, dd/MM")} às ${formatTime(slot.start_time)}`
  const paying = bookings.filter((b) => refundedStudentIds.has(b.student_id))
  const free = bookings.filter((b) => !refundedStudentIds.has(b.student_id))

  if (paying.length > 0) {
    await notifyUsers(client, {
      orgId: input.orgId,
      recipients: paying.map((b) => ({ userId: b.student_id })),
      type: 'dayuse_cancelled',
      title: 'Day use cancelado',
      body: `O day use de ${quando} (Espaço ${slot.court}) foi cancelado pela academia. `
        + 'Seu estorno já está registrado — escolha entre PIX e crédito no app.',
      channels: ['inapp', 'push'],
    })
  }
  if (free.length > 0) {
    await notifyUsers(client, {
      orgId: input.orgId,
      recipients: free.map((b) => ({ userId: b.student_id })),
      type: 'dayuse_cancelled',
      title: 'Day use cancelado',
      body: `O day use de ${quando} (Espaço ${slot.court}) foi cancelado pela academia.`,
      channels: ['inapp', 'push'],
    })
  }

  if (walletRestoredCents > 0) {
    console.info('[dayuse/cancelSlot] saldo devolvido', {
      slotId: input.slotId, total: formatDayUsePrice(walletRestoredCents),
    })
  }

  return { cancelled: bookings.length, refundsOpened, walletRestoredCents }
}
