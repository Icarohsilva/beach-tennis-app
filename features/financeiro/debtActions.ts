'use server'
// features/financeiro/debtActions.ts
// Ciclo da dívida de aula avulsa (spec 2026-07-22): o aluno vê/quita (MP ou
// PIX+comprovante) e o admin dá baixa, aprova/rejeita comprovante e cobra.
// Baixa nunca concede crédito — a dívida é de uma aula já assistida.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getStaffContext } from '@/lib/supabase/server'
import { notifyUsers, type NotificationChannel } from '@/lib/notifications/dispatch'
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { mpCreatePreference } from '@/lib/billing/mpClient'
import { computeMarketplaceFee } from '@/lib/billing/fees'
import { getSiteUrl } from '@/lib/utils/siteUrl'

const SETTLE_METHODS = ['dinheiro', 'pix', 'maquininha', 'outro'] as const
type SettleMethod = (typeof SETTLE_METHODS)[number]

interface CheckoutResult {
  initPoint?: string
  error?: string
}

// --- helpers ---------------------------------------------------------------

/** Garante que o chamador é dono da academia ativa. Retorna ctx ou erro. */
async function requireOwnerCtx(): Promise<
  { userId: string; orgId: string } | { error: string }
> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  if (!ctx.isOwner) return { error: 'Sem permissão.' }
  return { userId: ctx.userId, orgId: ctx.organizationId }
}

// --- admin: baixa ----------------------------------------------------------

/** Dá baixa manual numa pendência de aula (admin/dono). */
export async function markDebtPaid(
  paymentId: string,
  method: string,
): Promise<{ error?: string }> {
  const ctx = await requireOwnerCtx()
  if ('error' in ctx) return ctx
  if (!SETTLE_METHODS.includes(method as SettleMethod)) return { error: 'Método inválido.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      settled_by: ctx.userId,
      settled_method: method,
    })
    .eq('id', paymentId)
    .eq('organization_id', ctx.orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
  if (error) return { error: 'Erro ao dar baixa. Tente novamente.' }

  revalidatePath('/admin/financeiro/cobranca')
  revalidatePath('/admin/financeiro')
  return {}
}

/** Dá baixa em TODAS as pendências de aula do aluno naquela academia. */
export async function markAllDebtsPaid(
  studentId: string,
  method: string,
): Promise<{ error?: string }> {
  const ctx = await requireOwnerCtx()
  if ('error' in ctx) return ctx
  if (!SETTLE_METHODS.includes(method as SettleMethod)) return { error: 'Método inválido.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('payments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      settled_by: ctx.userId,
      settled_method: method,
    })
    .eq('student_id', studentId)
    .eq('organization_id', ctx.orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
  if (error) return { error: 'Erro ao quitar as pendências. Tente novamente.' }

  revalidatePath('/admin/financeiro/cobranca')
  revalidatePath('/admin/financeiro')
  return {}
}

/** Aprova o comprovante PIX: mesma baixa, método 'pix'. */
export async function approveDebtReceipt(paymentId: string): Promise<{ error?: string }> {
  return markDebtPaid(paymentId, 'pix')
}

/** Rejeita o comprovante: limpa e avisa o aluno com o motivo. */
export async function rejectDebtReceipt(
  paymentId: string,
  reason: string,
): Promise<{ error?: string }> {
  const ctx = await requireOwnerCtx()
  if ('error' in ctx) return ctx

  const admin = createAdminClient()
  const { data: pay } = await admin
    .from('payments')
    .select('id, student_id')
    .eq('id', paymentId)
    .eq('organization_id', ctx.orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    .maybeSingle()
  const row = pay as { id: string; student_id: string } | null
  if (!row) return { error: 'Pendência não encontrada.' }

  const { error } = await admin
    .from('payments')
    .update({ receipt_url: null, receipt_uploaded_at: null })
    .eq('id', paymentId)
    .eq('organization_id', ctx.orgId)
  if (error) return { error: 'Erro ao rejeitar comprovante. Tente novamente.' }

  // Sem o aviso o aluno não entende por que segue bloqueado.
  try {
    const { data: emailRow } = await admin
      .from('user_emails')
      .select('email')
      .eq('id', row.student_id)
      .maybeSingle()
    const { data: profileRow } = await admin
      .from('profiles')
      .select('phone')
      .eq('id', row.student_id)
      .maybeSingle()
    const trimmed = reason.trim()
    await notifyUsers(admin, {
      orgId: ctx.orgId,
      recipients: [{
        userId: row.student_id,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profileRow as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'payment_past_due',
      title: 'Comprovante recusado',
      body: trimmed
        ? `Seu comprovante de pagamento foi recusado: ${trimmed}. Envie um novo comprovante ou pague online em Financeiro.`
        : 'Seu comprovante de pagamento foi recusado. Envie um novo comprovante ou pague online em Financeiro.',
      channels: ['inapp', 'push'],
    })
  } catch (err) {
    console.error('[rejectDebtReceipt] notifyUsers falhou', err)
  }

  revalidatePath('/admin/financeiro/cobranca')
  return {}
}

/** Admin dispara a cobrança da dívida total do aluno nos canais escolhidos. */
export async function chargeDebt(
  studentId: string,
  channels: NotificationChannel[],
): Promise<{ error?: string }> {
  const ctx = await requireOwnerCtx()
  if ('error' in ctx) return ctx
  const allowed = channels.filter((c) => ['inapp', 'email', 'whatsapp', 'push'].includes(c))
  if (allowed.length === 0) return { error: 'Escolha ao menos um canal.' }

  const admin = createAdminClient()
  const { data: debtRows } = await admin
    .from('payments')
    .select('amount')
    .eq('student_id', studentId)
    .eq('organization_id', ctx.orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    // Mesmo recorte de getOrgDebtors: a pendência de check-in é cobrada pela tela
    // de Controle Wellhub, com a mensagem dela.
    .eq('missed_checkin', false)
  const rows = (debtRows ?? []) as { amount: number }[]
  if (rows.length === 0) return { error: 'Este aluno não tem pendências de aula.' }
  const total = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100

  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', ctx.orgId)
    .maybeSingle()
  const orgName = (org as { name: string } | null)?.name ?? 'sua academia'

  try {
    const { data: emailRow } = await admin
      .from('user_emails')
      .select('email')
      .eq('id', studentId)
      .maybeSingle()
    const { data: profileRow } = await admin
      .from('profiles')
      .select('phone')
      .eq('id', studentId)
      .maybeSingle()
    await notifyUsers(admin, {
      orgId: ctx.orgId,
      recipients: [{
        userId: studentId,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: (profileRow as { phone: string | null } | null)?.phone ?? null,
      }],
      type: 'payment_past_due',
      title: 'Aula avulsa em aberto',
      body: `Você tem R$ ${total.toFixed(2).replace('.', ',')} em aberto de aulas avulsas na ${orgName}. Regularize em Financeiro para voltar a agendar.`,
      channels: allowed,
    })
  } catch (err) {
    console.error('[chargeDebt] notifyUsers falhou', err)
    return { error: 'Não foi possível enviar a cobrança. Tente novamente.' }
  }

  return {}
}

// --- aluno -----------------------------------------------------------------

/** Aluno grava o path do comprovante enviado ao bucket payment-receipts. */
export async function submitDebtReceipt(
  paymentId: string,
  receiptPath: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  // Valida formato do path: deve ser {paymentId}/{userId}/receipt.* — a mesma
  // convenção que faz a RLS do bucket cobrir.
  if (!receiptPath.startsWith(`${paymentId}/`)) {
    return { error: 'Caminho do comprovante inválido.' }
  }

  const admin = createAdminClient()
  const { data: pay } = await admin
    .from('payments')
    .select('id')
    .eq('id', paymentId)
    .eq('student_id', user.id)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    .maybeSingle()
  if (!pay) return { error: 'Pendência não encontrada.' }

  const { error } = await admin
    .from('payments')
    .update({ receipt_url: receiptPath, receipt_uploaded_at: new Date().toISOString() })
    .eq('id', paymentId)
    .eq('student_id', user.id)
  if (error) return { error: 'Erro ao salvar comprovante. Tente novamente.' }

  revalidatePath('/financeiro')
  return {}
}

/** Aluno paga uma pendência EXISTENTE via Checkout Pro (não insere linha nova). */
export async function payDebtCheckout(paymentId: string): Promise<CheckoutResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const admin = createAdminClient()
  const { data: payRaw } = await admin
    .from('payments')
    .select('id, amount, status, session_id')
    .eq('id', paymentId)
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  const pay = payRaw as { id: string; amount: number; status: string; session_id: string | null } | null
  if (!pay || pay.status !== 'pending' || !pay.session_id) {
    return { error: 'Pendência não encontrada.' }
  }
  const amount = Number(pay.amount)
  if (amount <= 0) return { error: 'Esta pendência não tem valor a pagar. Fale com a academia.' }

  const token = await getConnectedMpToken(orgId)
  if (!token) return { error: 'Pagamento online indisponível. Fale com a academia.' }

  const { data: org } = await admin
    .from('organizations')
    .select('platform_fee_pct')
    .eq('id', orgId)
    .single()
  const feePct = Number((org as { platform_fee_pct?: number } | null)?.platform_fee_pct ?? 0)

  try {
    const pref = await mpCreatePreference(token, {
      items: [
        { title: 'Aula avulsa em aberto', quantity: 1, unit_price: amount, currency_id: 'BRL' },
      ],
      external_reference: pay.id,
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago?org=${orgId}`,
      // Mesmo bug de back_url do TLD .website: sempre a raiz (o MP anexa
      // ?external_reference=... e /retorno-pagamento roteia).
      back_urls: { success: getSiteUrl(), pending: getSiteUrl(), failure: getSiteUrl() },
      marketplace_fee: computeMarketplaceFee(amount, feePct),
    })
    return { initPoint: pref.init_point }
  } catch (e) {
    console.error('[payDebtCheckout] preference falhou', e)
    return { error: 'Não foi possível iniciar o pagamento. Tente novamente.' }
  }
}
