'use server'
// features/aulas/vacationActions.ts
// Férias do aluno: pedir, aprovar, recusar, cancelar.
//
// Existe porque o único meio-termo era inativar o cadastro
// (memberships.archived_at), que cancela plano e matrículas — grosso demais para
// quem vai viajar três semanas. Sem nada, a geração semanal seguia reservando o
// aluno em todas as fixas e ele ocupava vaga que não ia usar.
//
// Férias APROVADA congela duas coisas: o aluno sai da geração da grade e não
// reserva sozinho pelo app. Pedido pendente não muda nada — só a aprovação vale.
//
// O que férias NÃO faz: mexer em cobrança. Suspender mensalidade envolve o
// Mercado Pago (adminCancelStudentPlan) e é decisão comercial, não operacional.
import { revalidatePath } from 'next/cache'
import { createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from './authGuards'
import { cancelFutureBookings } from './cancelBookings'
import { promoteFromWaitlist } from './waitlistActions'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { brtToday } from '@/lib/utils/gridSchedule'
import { overlaps, type VacationPeriod } from '@/lib/aulas/vacation'
import { formatDate } from '@/lib/utils/dateHelpers'
import * as Sentry from '@sentry/nextjs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Validação comum ao pedido e à marcação direta do admin. */
function validatePeriod(startsOn: string, endsOn: string): string | null {
  if (!DATE_RE.test(startsOn) || !DATE_RE.test(endsOn)) return 'Datas inválidas.'
  if (endsOn < startsOn) return 'A data de volta tem de ser igual ou depois da de saída.'
  return null
}

/**
 * Já existe período ativo cruzando este?
 *
 * Dois períodos cobrindo o mesmo dia não somam nada e criam ambiguidade na hora
 * de cancelar um deles ("cancelei as férias e continuo de férias"). Pendente
 * também conta: aprovar o segundo depois deixaria os dois em pé.
 */
async function hasOverlap(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  orgId: string,
  periodo: VacationPeriod,
  ignoreId?: string,
): Promise<boolean> {
  const { data } = await adminClient
    .from('vacations')
    .select('id, starts_on, ends_on')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .in('status', ['pending', 'approved'])

  return ((data ?? []) as { id: string; starts_on: string; ends_on: string }[]).some(
    (v) =>
      v.id !== ignoreId &&
      overlaps(periodo, { startsOn: v.starts_on, endsOn: v.ends_on }),
  )
}

/**
 * Tira o aluno das aulas do período, devolvendo.
 *
 * A academia não é quem falta — é o aluno que avisou com antecedência que não
 * vem. Então a aula volta: crédito estornado para quem debitou e a reserva
 * isenta da cota. `cancelFutureBookings` já faz exatamente isso; aqui só se
 * delimita a janela.
 *
 * `onlyFromEnrollment: false` de propósito: a avulsa que ele marcou para o meio
 * das férias também precisa sair, senão a vaga fica presa a quem viajou.
 */
async function freeUpPeriod(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  orgId: string,
  startsOn: string,
  endsOn: string,
): Promise<void> {
  const hoje = brtToday(new Date())
  // Nunca mexe no passado: aula que já aconteceu não se desfaz.
  const from = startsOn > hoje ? startsOn : hoje
  if (from > endsOn) return

  const { freedSessionIds } = await cancelFutureBookings(adminClient, {
    studentId,
    orgId,
    onlyFromEnrollment: false,
    from,
    to: endsOn,
    refundReason: `Férias de ${formatDate(startsOn)} a ${formatDate(endsOn)}`,
  })

  // Vaga liberada: a fila de espera de cada sessão é avisada. Best-effort — as
  // férias já estão gravadas e não podem ser desfeitas por falha de aviso.
  for (const sessionId of Array.from(new Set(freedSessionIds))) {
    try {
      await promoteFromWaitlist(sessionId)
    } catch (err) {
      console.error('[vacation] promoteFromWaitlist falhou', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** Aviso ao aluno. Best-effort: nunca derruba a decisão já gravada. */
async function notifyStudent(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
  studentId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    await notifyUsers(adminClient, {
      orgId,
      recipients: [{ userId: studentId }],
      type: 'vacation',
      title,
      body,
      channels: ['inapp', 'push'],
    })
  } catch (err) {
    console.error('[vacation] notifyUsers falhou', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'vacation' },
      extra: { studentId, orgId },
    })
  }
}

// ---------------------------------------------------------------------------
// Aluno pede
// ---------------------------------------------------------------------------

/**
 * O aluno pede férias. Nasce `pending` — nada muda para ele até a arena aprovar.
 */
export async function requestVacation(
  startsOn: string,
  endsOn: string,
): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado.' }
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const invalid = validatePeriod(startsOn, endsOn)
  if (invalid) return { error: invalid }
  if (endsOn < brtToday(new Date())) {
    return { error: 'Esse período já passou. Escolha datas futuras.' }
  }

  const adminClient = createAdminClient()
  if (await hasOverlap(adminClient, user.id, orgId, { startsOn, endsOn })) {
    return { error: 'Você já tem um período de férias que cruza com essas datas.' }
  }

  const { error } = await adminClient.from('vacations').insert({
    organization_id: orgId,
    student_id: user.id,
    starts_on: startsOn,
    ends_on: endsOn,
    status: 'pending',
    requested_by: user.id,
  })
  if (error) return { error: 'Erro ao enviar o pedido. Tente novamente.' }

  // Avisa os admins da academia — sem isso o pedido só aparece se alguém abrir
  // a tela de alunos por acaso.
  try {
    const { data: admins } = await adminClient
      .from('memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('role', 'admin')
      .is('archived_at', null)

    const adminIds = ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id)
    if (adminIds.length > 0) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()
      const nome = (profile as { full_name: string | null } | null)?.full_name ?? 'Um aluno'

      await notifyUsers(adminClient, {
        orgId,
        recipients: adminIds.map((id) => ({ userId: id })),
        type: 'vacation_request',
        title: 'Pedido de férias',
        body: `${nome} pediu férias de ${formatDate(startsOn)} a ${formatDate(endsOn)}. Aprove ou recuse na ficha do aluno.`,
        channels: ['inapp', 'push'],
      })
    }
  } catch (err) {
    console.error('[requestVacation] aviso aos admins falhou', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  revalidatePath('/perfil')
  return {}
}

// ---------------------------------------------------------------------------
// Admin marca, aprova, recusa
// ---------------------------------------------------------------------------

/**
 * Admin marca férias direto. Nasce aprovada — quem marcou é quem aprova.
 */
export async function setVacationForStudent(
  studentId: string,
  startsOn: string,
  endsOn: string,
): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const invalid = validatePeriod(startsOn, endsOn)
  if (invalid) return { error: invalid }

  const adminClient = createAdminClient()
  if (await hasOverlap(adminClient, studentId, orgId, { startsOn, endsOn })) {
    return { error: 'Esse aluno já tem um período de férias que cruza com essas datas.' }
  }

  const now = new Date().toISOString()
  const { error } = await adminClient.from('vacations').insert({
    organization_id: orgId,
    student_id: studentId,
    starts_on: startsOn,
    ends_on: endsOn,
    status: 'approved',
    requested_by: userId,
    reviewed_by: userId,
    reviewed_at: now,
  })
  if (error) return { error: 'Erro ao salvar as férias. Tente novamente.' }

  await freeUpPeriod(adminClient, studentId, orgId, startsOn, endsOn)
  await notifyStudent(
    adminClient,
    orgId,
    studentId,
    'Férias registradas',
    `A academia registrou suas férias de ${formatDate(startsOn)} a ${formatDate(endsOn)}. Você sai das aulas desse período e nada é cobrado da sua cota.`,
  )

  revalidatePath(`/admin/alunos/${studentId}`)
  revalidatePath('/admin/alunos')
  revalidatePath('/home')
  return {}
}

/** Admin aprova um pedido pendente: é aqui que as férias passam a valer. */
export async function approveVacation(vacationId: string): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const { data: row } = await adminClient
    .from('vacations')
    .select('id, student_id, starts_on, ends_on, status')
    .eq('id', vacationId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const vac = row as {
    id: string
    student_id: string
    starts_on: string
    ends_on: string
    status: string
  } | null
  if (!vac) return { error: 'Pedido não encontrado.' }
  if (vac.status !== 'pending') return { error: 'Esse pedido já foi respondido.' }

  // Reconfere na hora de aprovar: entre o pedido e a resposta o admin pode ter
  // marcado outro período na mão.
  if (
    await hasOverlap(
      adminClient,
      vac.student_id,
      orgId,
      { startsOn: vac.starts_on, endsOn: vac.ends_on },
      vac.id,
    )
  ) {
    return { error: 'Esse período cruza com outras férias já registradas para o aluno.' }
  }

  const { error } = await adminClient
    .from('vacations')
    .update({ status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('id', vacationId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao aprovar. Tente novamente.' }

  await freeUpPeriod(adminClient, vac.student_id, orgId, vac.starts_on, vac.ends_on)
  await notifyStudent(
    adminClient,
    orgId,
    vac.student_id,
    'Férias aprovadas',
    `Suas férias de ${formatDate(vac.starts_on)} a ${formatDate(vac.ends_on)} foram aprovadas. Você sai das aulas desse período e nada é cobrado da sua cota.`,
  )

  revalidatePath(`/admin/alunos/${vac.student_id}`)
  revalidatePath('/admin/alunos')
  revalidatePath('/home')
  return {}
}

/** Admin recusa. Nada muda para o aluno além do aviso. */
export async function rejectVacation(
  vacationId: string,
  note?: string,
): Promise<{ error?: string }> {
  const { orgId, userId, error: authErr } = await requireAdmin()
  if (authErr) return { error: authErr }

  const adminClient = createAdminClient()
  const { data: row } = await adminClient
    .from('vacations')
    .select('id, student_id, starts_on, ends_on, status')
    .eq('id', vacationId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const vac = row as {
    id: string
    student_id: string
    starts_on: string
    ends_on: string
    status: string
  } | null
  if (!vac) return { error: 'Pedido não encontrado.' }
  if (vac.status !== 'pending') return { error: 'Esse pedido já foi respondido.' }

  const { error } = await adminClient
    .from('vacations')
    .update({
      status: 'rejected',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq('id', vacationId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao recusar. Tente novamente.' }

  await notifyStudent(
    adminClient,
    orgId,
    vac.student_id,
    'Pedido de férias recusado',
    `Seu pedido de férias de ${formatDate(vac.starts_on)} a ${formatDate(vac.ends_on)} não foi aprovado.${note?.trim() ? ` Motivo: ${note.trim()}.` : ''} Suas aulas seguem normalmente.`,
  )

  revalidatePath(`/admin/alunos/${vac.student_id}`)
  revalidatePath('/admin/alunos')
  return {}
}

/**
 * Cancela um período — o aluno desistindo do pedido, ou o admin encerrando
 * férias já aprovadas (voltou antes).
 *
 * As reservas do período **não** voltam sozinhas: a grade já foi gerada sem ele
 * e ressuscitar reserva cancelada esbarraria em lotação e crédito. O aluno entra
 * de novo nas aulas que quiser — e é o que a mensagem diz.
 */
export async function cancelVacation(vacationId: string): Promise<{ error?: string }> {
  const user = await getAuthUser()
  if (!user) return { error: 'Não autenticado.' }
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const adminClient = createAdminClient()
  const { data: row } = await adminClient
    .from('vacations')
    .select('id, student_id, status')
    .eq('id', vacationId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const vac = row as { id: string; student_id: string; status: string } | null
  if (!vac) return { error: 'Período não encontrado.' }
  if (!['pending', 'approved'].includes(vac.status)) {
    return { error: 'Esse período já está encerrado.' }
  }

  // O próprio aluno pode cancelar o que é dele; qualquer outra pessoa precisa
  // ser admin da academia.
  if (vac.student_id !== user.id) {
    const { error: authErr } = await requireAdmin()
    if (authErr) return { error: authErr }
  }

  const { error } = await adminClient
    .from('vacations')
    .update({ status: 'cancelled' })
    .eq('id', vacationId)
    .eq('organization_id', orgId)
  if (error) return { error: 'Erro ao cancelar. Tente novamente.' }

  revalidatePath('/perfil')
  revalidatePath(`/admin/alunos/${vac.student_id}`)
  revalidatePath('/admin/alunos')
  revalidatePath('/home')
  return {}
}
