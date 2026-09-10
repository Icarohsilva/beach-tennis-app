'use server'

// features/dayuse/receiptActions.ts
// PIX manual do day use: o aluno anexa o comprovante, o admin confere.
//
// Espelha o fluxo do torneio (uploadEntryPaymentReceipt) com uma diferença que
// o torneio não tem: day use tem CAPACIDADE, então confirmar não é só marcar o
// pagamento — é decidir se a vaga continua sendo daquela pessoa.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { openRefundForBooking } from './refunds'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

/**
 * O aluno anexa o comprovante do PIX.
 *
 * Sobe por server action (service role) e não direto do client: a policy do
 * bucket `payment-receipts` exige que a pasta seja o próprio uid, e o avulso da
 * página pública pode ter acabado de criar a conta — o mesmo motivo de
 * `uploadEntryPaymentReceipt`.
 */
export async function uploadDayUseReceipt(
  bookingId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Envie um arquivo.' }
  const ext = MIME_TO_EXT[file.type]
  if (!ext) return { error: 'Formato não suportado. Envie JPG, PNG ou WEBP.' }
  if (file.size > MAX_RECEIPT_BYTES) return { error: 'Arquivo muito grande (máx. 5MB).' }

  const admin = createAdminClient()
  const { data: bookingRaw } = await admin
    .from('dayuse_bookings')
    .select('id, slot_id, student_id, status')
    .eq('id', bookingId)
    .eq('student_id', user.id)
    .maybeSingle()
  if (!bookingRaw) return { error: 'Reserva não encontrada.' }
  const booking = bookingRaw as { slot_id: string; status: string }
  if (booking.status === 'cancelled') {
    return { error: 'Esta reserva foi cancelada. Reserve de novo antes de pagar.' }
  }

  const path = `dayuse/${bookingId}/receipt.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from('payment-receipts')
    .upload(path, bytes, { upsert: true, contentType: file.type })
  if (upErr) return { error: 'Erro ao enviar o comprovante. Tente novamente.' }

  const { error: updErr } = await admin
    .from('dayuse_bookings')
    .update({ receipt_url: path, receipt_uploaded_at: new Date().toISOString() })
    .eq('id', bookingId)
  if (updErr) return { error: 'Erro ao salvar o comprovante. Tente novamente.' }

  revalidatePath(`/d/${booking.slot_id}`)
  revalidatePath('/admin/financeiro/day-use')
  return {}
}

/**
 * Admin confere o comprovante e confirma a reserva.
 *
 * Confirma a reserva e dá baixa no pagamento na mesma passada, e zera
 * `hold_until` — reserva confirmada não tem prazo, e um prazo vencido numa
 * confirmada a apagaria da contagem de ocupação.
 *
 * NÃO reconfere capacidade: a vaga foi contada quando a reserva nasceu e ficou
 * segurada por `hold_until`. Reconferir aqui puniria o aluno que pagou por a
 * arena ter demorado a olhar.
 */
export async function confirmDayUseReceipt(bookingId: string): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  const { data: bookingRaw } = await admin
    .from('dayuse_bookings')
    .select('id, slot_id, student_id, status, dayuse_slots(date, start_time)')
    .eq('id', bookingId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!bookingRaw) return { error: 'Reserva não encontrada.' }
  const booking = bookingRaw as {
    slot_id: string
    student_id: string
    status: string
    dayuse_slots: { date: string; start_time: string } | { date: string; start_time: string }[] | null
  }

  const { data: confirmed } = await admin
    .from('dayuse_bookings')
    .update({ status: 'confirmed', hold_until: null })
    .eq('id', bookingId)
    .eq('status', 'pending_payment')
    .select('id')
    .maybeSingle()
  if (!confirmed) return { error: 'Esta reserva não está mais aguardando pagamento.' }

  await admin
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      settled_by: userId,
      settled_method: 'pix',
    })
    .eq('dayuse_booking_id', bookingId)
    .eq('status', 'pending')

  const slot = Array.isArray(booking.dayuse_slots) ? booking.dayuse_slots[0] : booking.dayuse_slots
  await notifyUsers(admin, {
    orgId,
    recipients: [{ userId: booking.student_id }],
    type: 'dayuse_payment_confirmed',
    title: 'Pagamento confirmado',
    body: slot
      ? `Sua vaga no day use de ${formatDate(slot.date, "EEEE, dd/MM")} às ${formatTime(slot.start_time)} está garantida.`
      : 'Sua vaga no day use está garantida.',
    channels: ['inapp', 'push'],
  })

  revalidatePath('/admin/financeiro/day-use')
  revalidatePath(`/d/${booking.slot_id}`)
  revalidatePath('/agendar/dayuse')
  return {}
}

/**
 * Admin recusa o comprovante: a reserva cai e a vaga volta para a arena.
 *
 * Passa por `openRefundForBooking` mesmo assim. Parece contraintuitivo, mas é o
 * caso do aluno que pagou de verdade E também tinha abatido crédito: recusar o
 * comprovante não pode ficar com o crédito dele. Como o pagamento nunca virou
 * `paid`, nenhum estorno de PIX é aberto — só a parte da carteira volta.
 */
export async function rejectDayUseReceipt(
  bookingId: string,
  reason: string,
): Promise<{ error?: string }> {
  const { orgId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const admin = createAdminClient()
  const { data: bookingRaw } = await admin
    .from('dayuse_bookings')
    .select('id, slot_id, student_id, booked_at, status, dayuse_slots(date, start_time)')
    .eq('id', bookingId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!bookingRaw) return { error: 'Reserva não encontrada.' }
  const booking = bookingRaw as {
    slot_id: string
    student_id: string
    booked_at: string
    dayuse_slots: { date: string; start_time: string } | { date: string; start_time: string }[] | null
  }

  const { data: cancelled } = await admin
    .from('dayuse_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), hold_until: null })
    .eq('id', bookingId)
    .eq('status', 'pending_payment')
    .select('id')
    .maybeSingle()
  if (!cancelled) return { error: 'Esta reserva não está mais aguardando pagamento.' }

  await admin
    .from('payments')
    .update({ status: 'failed' })
    .eq('dayuse_booking_id', bookingId)
    .eq('status', 'pending')

  const slot = Array.isArray(booking.dayuse_slots) ? booking.dayuse_slots[0] : booking.dayuse_slots
  if (slot) {
    await openRefundForBooking(admin, {
      orgId,
      bookingId,
      studentId: booking.student_id,
      slot,
      bookedAtIso: booking.booked_at,
      cause: 'arena_cancelou',
    })
  }

  const motivo = reason.trim().slice(0, 200)
  await notifyUsers(admin, {
    orgId,
    recipients: [{ userId: booking.student_id }],
    type: 'dayuse_payment_rejected',
    title: 'Comprovante não confirmado',
    body: `A academia não conseguiu confirmar seu pagamento do day use e a reserva foi liberada.`
      + (motivo ? ` Motivo: ${motivo}` : '')
      + ' Fale com a arena se o valor já saiu da sua conta.',
    channels: ['inapp', 'push'],
  })

  revalidatePath('/admin/financeiro/day-use')
  revalidatePath(`/d/${booking.slot_id}`)
  revalidatePath('/agendar/dayuse')
  return {}
}
