'use server'

// features/dayuse/refundActions.ts
// O ciclo do estorno de day use: aluno informa a chave, aluno troca por
// crédito, admin paga e anexa comprovante, aluno confirma que recebeu.
//
// Escrita sempre por service role: o estorno diz quanto a academia DEVE, então
// nenhuma policy de insert/update existe em `dayuse_refunds` (ver a migração).
import { revalidatePath } from 'next/cache'
import { createAdminClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/features/aulas/authGuards'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { canSwitchToCredit, type RefundStatus } from '@/lib/dayuse/refundRules'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { WALLET_REASONS } from '@/lib/wallet/wallet'
import { creditWallet } from '@/features/wallet/spendWallet'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_PROOF_BYTES = 5 * 1024 * 1024

/** Limpa a chave PIX digitada: espaços nas pontas e nada além do razoável. */
function cleanKey(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  return v.slice(0, 140)
}

/**
 * Chave PIX de estorno informada na RESERVA (opcional).
 *
 * Guardada na reserva porque é coletada antes de existir estorno. Só o dono da
 * reserva escreve — o filtro por `student_id` é a autorização.
 */
export async function setBookingRefundPixKey(
  bookingId: string,
  pixKey: string,
  pixOwner: string,
): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado' }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('dayuse_bookings')
    .update({ refund_pix_key: cleanKey(pixKey), refund_pix_owner: cleanKey(pixOwner) })
    .eq('id', bookingId)
    .eq('student_id', user.id)
    .select('slot_id')
    .maybeSingle()

  if (error) return { error: 'Não foi possível salvar a chave. Tente novamente.' }
  if (!updated) return { error: 'Reserva não encontrada.' }

  revalidatePath(`/d/${(updated as { slot_id: string }).slot_id}`)
  return {}
}

/** Corrigir a chave depois de o estorno abrir — chave velha erra o PIX. */
export async function setRefundPixKey(
  refundId: string,
  pixKey: string,
  pixOwner: string,
): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado' }
  const key = cleanKey(pixKey)
  if (!key) return { error: 'Informe a chave PIX.' }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('dayuse_refunds')
    .update({ pix_key: key, pix_owner: cleanKey(pixOwner) })
    .eq('id', refundId)
    .eq('student_id', user.id)
    // Depois de pago não há mais o que corrigir: o PIX já saiu.
    .eq('status', 'pendente')
    .select('booking_id')
    .maybeSingle()

  if (error) return { error: 'Não foi possível salvar a chave. Tente novamente.' }
  if (!updated) return { error: 'Este estorno já foi processado.' }

  revalidatePath('/financeiro')
  return {}
}

/**
 * O aluno troca PIX por crédito no app.
 *
 * Só ELE pode fazer isto (o filtro por `student_id`) e só enquanto `pendente`:
 * depois de `pago` o dinheiro já saiu da conta da academia. O `.eq('status',
 * 'pendente')` no update é a trava de verdade — fecha a corrida entre o clique
 * do aluno e o admin marcando como pago no mesmo instante.
 */
export async function switchRefundToCredit(refundId: string): Promise<{ error?: string; balanceCents?: number }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado' }

  const admin = createAdminClient()
  const { data: refundRaw } = await admin
    .from('dayuse_refunds')
    .select('id, organization_id, student_id, amount_cents, status')
    .eq('id', refundId)
    .eq('student_id', user.id)
    .maybeSingle()
  if (!refundRaw) return { error: 'Estorno não encontrado.' }
  const refund = refundRaw as {
    organization_id: string; student_id: string; amount_cents: number; status: RefundStatus
  }

  if (!canSwitchToCredit(refund.status)) {
    return { error: 'Este estorno já foi processado e não pode virar crédito.' }
  }

  // Marca ANTES de creditar: se o crédito falhar, o estorno voltando para
  // 'pendente' é conserto simples; creditar primeiro e falhar a marcação daria
  // saldo e estorno em aberto ao mesmo tempo.
  const { data: claimed } = await admin
    .from('dayuse_refunds')
    .update({ method: 'credito', status: 'creditado' })
    .eq('id', refundId)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle()
  if (!claimed) return { error: 'Este estorno já foi processado.' }

  const r = await creditWallet(admin, {
    orgId: refund.organization_id,
    studentId: refund.student_id,
    cents: refund.amount_cents,
    reason: WALLET_REASONS.dayuseRefund,
    sourceTable: 'dayuse_refunds',
    sourceId: refundId,
  })
  if (r.error) {
    await admin
      .from('dayuse_refunds')
      .update({ method: 'pix', status: 'pendente' })
      .eq('id', refundId)
    return { error: r.error }
  }

  revalidatePath('/financeiro')
  return { balanceCents: r.balanceCents }
}

/**
 * Admin registra o PIX feito e anexa o comprovante.
 *
 * Upload por service role no bucket privado `payment-receipts`, como
 * `uploadEntryPaymentReceipt`: a policy do bucket só deixa o próprio usuário
 * escrever na pasta dele, e aqui quem envia é o admin, não o dono do dinheiro.
 */
export async function markRefundPaid(
  refundId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'Anexe o comprovante do PIX.' }
  const ext = MIME_TO_EXT[file.type]
  if (!ext) return { error: 'Formato não suportado. Envie JPG, PNG ou WEBP.' }
  if (file.size > MAX_PROOF_BYTES) return { error: 'Arquivo muito grande (máx. 5MB).' }

  const admin = createAdminClient()
  const { data: refundRaw } = await admin
    .from('dayuse_refunds')
    .select('id, organization_id, student_id, amount_cents, status')
    .eq('id', refundId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!refundRaw) return { error: 'Estorno não encontrado.' }
  const refund = refundRaw as {
    student_id: string; amount_cents: number; status: RefundStatus
  }
  if (refund.status === 'creditado') {
    return { error: 'O aluno converteu este estorno em crédito. Não há PIX a fazer.' }
  }

  const path = `dayuse-refunds/${refundId}/proof.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await admin.storage
    .from('payment-receipts')
    .upload(path, bytes, { upsert: true, contentType: file.type })
  if (upErr) return { error: 'Erro ao enviar o comprovante. Tente novamente.' }

  const { data: updated } = await admin
    .from('dayuse_refunds')
    .update({
      status: 'pago',
      proof_url: path,
      paid_at: new Date().toISOString(),
      paid_by: userId,
    })
    .eq('id', refundId)
    // Não sobrescreve conversão em crédito decidida no mesmo instante.
    .in('status', ['pendente', 'pago'])
    .select('id')
    .maybeSingle()
  if (!updated) return { error: 'Este estorno mudou de estado. Recarregue a página.' }

  // Push é o canal que alcança o avulso: ele não tem /home nem sino de
  // notificação, então sem push ele só descobriria abrindo a página do day use.
  await notifyUsers(admin, {
    orgId,
    recipients: [{ userId: refund.student_id }],
    type: 'dayuse_refund_paid',
    title: 'Estorno realizado',
    body: `A academia enviou o estorno de ${formatDayUsePrice(refund.amount_cents)} por PIX. `
      + 'Confira na sua conta e confirme o recebimento no app.',
    channels: ['inapp', 'push'],
  })

  revalidatePath('/admin/financeiro/day-use')
  revalidatePath('/financeiro')
  return {}
}

/** O aluno confirma que o dinheiro caiu. */
export async function confirmRefundReceived(refundId: string): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado' }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('dayuse_refunds')
    .update({ status: 'confirmado', confirmed_at: new Date().toISOString() })
    .eq('id', refundId)
    .eq('student_id', user.id)
    .eq('status', 'pago')
    .select('id')
    .maybeSingle()

  if (error) return { error: 'Não foi possível confirmar. Tente novamente.' }
  if (!updated) return { error: 'Este estorno ainda não foi pago pela academia.' }

  revalidatePath('/financeiro')
  revalidatePath('/admin/financeiro/day-use')
  return {}
}
