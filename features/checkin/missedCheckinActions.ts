'use server'
// features/checkin/missedCheckinActions.ts
// Ações do Controle Wellhub: configurar o bloqueio/valor, dar baixa, perdoar e
// cobrar as pendências de check-in. Espelha features/financeiro/debtActions.ts.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getStaffContext } from '@/lib/supabase/server'
import { notifyUsers, type NotificationChannel } from '@/lib/notifications/dispatch'
import { buildMissedCheckinMessage, summarizeMissedCheckins } from '@/lib/checkin/missedCheckins'
import { getMissedCheckinSettings, BLOCK_LIMIT_KEY, PRICE_KEY } from './missedCheckinSettings'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import type { MissedCheckinStatus } from '@/types'

const SETTLE_METHODS = ['dinheiro', 'pix', 'maquininha', 'outro'] as const
type SettleMethod = (typeof SETTLE_METHODS)[number]

const CHANNELS: NotificationChannel[] = ['inapp', 'email', 'whatsapp', 'push']

/**
 * Staff da academia ativa. A tela toda é acessível ao professor (é ele quem cria as
 * pendências na chamada); só a configuração exige dono.
 */
async function requireStaff(): Promise<
  { userId: string; orgId: string; isOwner: boolean } | { error: string }
> {
  const ctx = await getStaffContext()
  if (!ctx) return { error: 'Não autenticado.' }
  return { userId: ctx.userId, orgId: ctx.organizationId, isOwner: ctx.isOwner }
}

// --- configuração (dono) ---------------------------------------------------

export async function updateMissedCheckinSettings(input: {
  blockLimit: number
  price: number
}): Promise<{ error?: string }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx
  if (!ctx.isOwner) return { error: 'Sem permissão.' }

  const { blockLimit, price } = input
  if (!Number.isInteger(blockLimit) || blockLimit < 0) {
    return { error: 'O limite de pendências deve ser um número inteiro não-negativo.' }
  }
  if (!Number.isFinite(price) || price < 0) {
    return { error: 'O valor da pendência não pode ser negativo.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('system_settings').upsert(
    [
      { organization_id: ctx.orgId, key: BLOCK_LIMIT_KEY, value: String(blockLimit) },
      { organization_id: ctx.orgId, key: PRICE_KEY, value: price.toFixed(2) },
    ],
    { onConflict: 'organization_id,key' },
  )
  if (error) return { error: 'Erro ao salvar as configurações. Tente novamente.' }

  revalidatePath('/admin/wellhub')
  return {}
}

// --- resolução (staff) ----------------------------------------------------

/** Dá baixa numa pendência de check-in, quitando também o payments vinculado. */
export async function settleMissedCheckin(
  pendencyId: string,
  method: string,
): Promise<{ error?: string }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx
  if (!SETTLE_METHODS.includes(method as SettleMethod)) return { error: 'Método inválido.' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('missed_checkins')
    .select('id, payment_id, status')
    .eq('id', pendencyId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()

  const pendency = row as { id: string; payment_id: string | null; status: MissedCheckinStatus } | null
  if (!pendency) return { error: 'Pendência não encontrada.' }
  if (pendency.status !== 'open') return { error: 'Esta pendência já foi resolvida.' }

  // O payments primeiro: o trigger payments_sync_missed_checkin já marca a pendência
  // como paga, e o update abaixo fecha os campos de auditoria de qualquer forma.
  if (pendency.payment_id) {
    await admin
      .from('payments')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        settled_by: ctx.userId,
        settled_method: method,
      })
      .eq('id', pendency.payment_id)
      .eq('organization_id', ctx.orgId)
      .eq('status', 'pending')
  }

  const { error } = await admin
    .from('missed_checkins')
    .update({
      status: 'paid',
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.userId,
      resolution_note: `Baixa manual (${method})`,
    })
    .eq('id', pendencyId)
    .eq('organization_id', ctx.orgId)
  if (error) return { error: 'Erro ao dar baixa. Tente novamente.' }

  revalidatePath('/admin/wellhub')
  return {}
}

/** Dá baixa em TODAS as pendências abertas do aluno. */
export async function settleAllMissedCheckins(
  studentId: string,
  method: string,
): Promise<{ error?: string }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx
  if (!SETTLE_METHODS.includes(method as SettleMethod)) return { error: 'Método inválido.' }

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('missed_checkins')
    .select('id, payment_id')
    .eq('student_id', studentId)
    .eq('organization_id', ctx.orgId)
    .eq('status', 'open')

  const pendencies = (rows ?? []) as { id: string; payment_id: string | null }[]
  if (pendencies.length === 0) return { error: 'Este aluno não tem pendências em aberto.' }

  const paymentIds = pendencies.map((p) => p.payment_id).filter((id): id is string => !!id)
  const now = new Date().toISOString()

  if (paymentIds.length > 0) {
    await admin
      .from('payments')
      .update({ status: 'paid', paid_at: now, settled_by: ctx.userId, settled_method: method })
      .in('id', paymentIds)
      .eq('organization_id', ctx.orgId)
      .eq('status', 'pending')
  }

  const { error } = await admin
    .from('missed_checkins')
    .update({
      status: 'paid',
      resolved_at: now,
      resolved_by: ctx.userId,
      resolution_note: `Baixa manual em lote (${method})`,
    })
    .in('id', pendencies.map((p) => p.id))
    .eq('organization_id', ctx.orgId)
  if (error) return { error: 'Erro ao quitar as pendências. Tente novamente.' }

  revalidatePath('/admin/wellhub')
  return {}
}

/**
 * Perdoa a pendência: atestado, aula cancelada pela chuva, erro de marcação do
 * professor. Sai da contagem do bloqueio, mas continua no histórico e no total do
 * que a academia deixou de receber — perdoar não é fingir que não houve perda.
 */
export async function waiveMissedCheckin(
  pendencyId: string,
  note: string,
): Promise<{ error?: string }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx

  const trimmed = note.trim()
  if (trimmed.length === 0) return { error: 'Escreva o motivo do perdão.' }
  if (trimmed.length > 300) return { error: 'O motivo é longo demais (máx. 300 caracteres).' }

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('missed_checkins')
    .select('id, payment_id, status')
    .eq('id', pendencyId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle()

  const pendency = row as { id: string; payment_id: string | null; status: MissedCheckinStatus } | null
  if (!pendency) return { error: 'Pendência não encontrada.' }
  if (pendency.status !== 'open') return { error: 'Esta pendência já foi resolvida.' }

  // Perdoada não se cobra: apaga o payments pendente, senão o aluno continuaria
  // vendo a cobrança no Financeiro depois de ser perdoado.
  if (pendency.payment_id) {
    await admin
      .from('payments')
      .delete()
      .eq('id', pendency.payment_id)
      .eq('organization_id', ctx.orgId)
      .eq('status', 'pending')
      .eq('missed_checkin', true)
  }

  const { error } = await admin
    .from('missed_checkins')
    .update({
      status: 'waived',
      payment_id: null,
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.userId,
      resolution_note: trimmed,
    })
    .eq('id', pendencyId)
    .eq('organization_id', ctx.orgId)
  if (error) return { error: 'Erro ao perdoar a pendência. Tente novamente.' }

  revalidatePath('/admin/wellhub')
  return {}
}

// --- cobrança (staff) -----------------------------------------------------

/** Cobra as pendências de check-in de um aluno nos canais escolhidos. */
export async function chargeMissedCheckins(
  studentId: string,
  channels: NotificationChannel[],
): Promise<{ error?: string }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx

  const result = await chargeOne(ctx.orgId, studentId, channels)
  if (result.error) return result

  revalidatePath('/admin/wellhub')
  return {}
}

/** Cobra todos os alunos com pendência em aberto. Best-effort por aluno. */
export async function chargeAllMissedCheckins(
  channels: NotificationChannel[],
): Promise<{ error?: string; sentCount?: number }> {
  const ctx = await requireStaff()
  if ('error' in ctx) return ctx

  const allowed = channels.filter((c) => CHANNELS.includes(c))
  if (allowed.length === 0) return { error: 'Escolha ao menos um canal.' }

  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('missed_checkins')
    .select('student_id')
    .eq('organization_id', ctx.orgId)
    .eq('status', 'open')

  const ids = Array.from(
    new Set(((rows ?? []) as { student_id: string }[]).map((r) => r.student_id)),
  )
  if (ids.length === 0) return { error: 'Nenhum aluno com pendência em aberto.' }

  // Sequencial de propósito: o volume é uma academia (dezenas de alunos) e cada
  // envio bate em e-mail/WhatsApp externos. Uma falha não aborta o lote.
  let sentCount = 0
  for (const studentId of ids) {
    const r = await chargeOne(ctx.orgId, studentId, allowed)
    if (!r.error) sentCount++
  }

  revalidatePath('/admin/wellhub')
  if (sentCount === 0) return { error: 'Não foi possível enviar nenhuma cobrança.' }
  return { sentCount }
}

async function chargeOne(
  orgId: string,
  studentId: string,
  channels: NotificationChannel[],
): Promise<{ error?: string }> {
  const allowed = channels.filter((c) => CHANNELS.includes(c))
  if (allowed.length === 0) return { error: 'Escolha ao menos um canal.' }

  const admin = createAdminClient()
  const { blockLimit } = await getMissedCheckinSettings(admin, orgId)

  const { data: rowsRaw } = await admin
    .from('missed_checkins')
    .select('id, session_date, amount, status')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'open')

  const rows = ((rowsRaw ?? []) as {
    id: string
    session_date: string
    amount: number | string
    status: MissedCheckinStatus
  }[]).map((r) => ({
    id: r.id,
    sessionDate: r.session_date,
    amount: Number(r.amount),
    status: r.status,
  }))
  if (rows.length === 0) return { error: 'Este aluno não tem pendências de check-in.' }

  const summary = summarizeMissedCheckins(rows, blockLimit)

  const [{ data: org }, { data: prof }, { data: emailRow }] = await Promise.all([
    admin.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    admin.from('profiles').select('full_name, phone').eq('id', studentId).maybeSingle(),
    admin.from('user_emails').select('email').eq('id', studentId).maybeSingle(),
  ])

  const orgName = (org as { name: string } | null)?.name ?? 'sua academia'
  const profile = prof as { full_name: string; phone: string | null } | null

  // Mesmo texto do link de WhatsApp: o aluno recebe a mesma mensagem pelos dois
  // caminhos, com as datas das pendências.
  const body = buildMissedCheckinMessage({
    studentName: profile?.full_name ?? 'Aluno',
    orgName,
    dates: summary.dates,
    amount: summary.openAmount,
    blocked: summary.blocked,
    payUrl: `${getSiteUrl()}/financeiro`,
  })

  try {
    await notifyUsers(admin, {
      orgId,
      recipients: [{
        userId: studentId,
        email: (emailRow as { email: string } | null)?.email ?? null,
        phone: profile?.phone ?? null,
      }],
      type: 'checkin_pendencia_cobranca',
      title: 'Check-in do parceiro em aberto',
      body,
      channels: allowed,
    })
  } catch (err) {
    console.error('[chargeMissedCheckins] notifyUsers falhou', { studentId, err })
    return { error: 'Não foi possível enviar a cobrança. Tente novamente.' }
  }

  return {}
}
