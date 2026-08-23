'use server'
// features/aulas/waitlistActions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { WaitlistStatus, StudentLevel, ClassType } from '@/types'
import type { AccessDenial } from '@/lib/utils/accessRules'
import * as Sentry from '@sentry/nextjs'
import { notifyUsers } from '@/lib/notifications/dispatch'
import { resolveSession, type SessionOverrides } from '@/lib/aulas/sessionOverride'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { canAutoEnter, openSpots } from '@/lib/aulas/waitlistPromotion'
import {
  buildAutoEnteredNotice,
  buildNowFirstNotice,
  buildRemovedFromWaitlistNotice,
  type WaitlistNotice,
  type WaitlistSessionRef,
} from '@/lib/aulas/waitlistMessages'
import { getMembershipFor, resolveStudentClassAccess } from './classAccessQuery'

// ---------------------------------------------------------------------------
// promoteFromWaitlist — o primeiro da fila entra AUTOMATICAMENTE
// ---------------------------------------------------------------------------

/**
 * Vaga abriu: coloca na aula quem está na frente da fila, um por vaga.
 *
 * Substitui o modelo de "avisa a fila inteira e a vaga fica com quem entrar
 * primeiro". Aquele modelo existia porque o anterior a ele — oferta individual
 * com 1h para aceitar — dependia de um cron para expirar a oferta, e no plano
 * Hobby da Vercel o cron roda 1x/dia: uma oferta não aceita segurava a fila por
 * ~24h e a vaga morria sem ninguém usar. A entrada automática não reintroduz
 * esse problema porque não existe oferta pendente para expirar: ou entra agora,
 * ou a vez passa.
 *
 * O que acontece, em ordem:
 *   1. Faltando menos de 1h para o início, NINGUÉM é promovido — a vaga fica
 *      aberta para quem quiser. Colocar alguém que não vai ver o aviso em tempo
 *      enche a turma no papel e esvazia na quadra (ver waitlistPromotion.ts).
 *   2. Para cada vaga, o primeiro da fila que PODE entrar entra e é avisado.
 *   3. Quem não pode entrar sai da fila e é avisado do motivo. Remoção em
 *      silêncio seria pior: ele esperaria para sempre por uma vaga que, com
 *      dívida ou cota estourada, nunca seria oferecida.
 *   4. No fim, quem ficou na frente da fila é avisado de que virou o primeiro —
 *      uma vez só, via `first_notified_at`.
 *
 * Nunca lança: é chamada depois de um cancelamento já gravado (fire-and-forget),
 * e falha aqui não pode desfazer a saída que abriu a vaga.
 */
export async function promoteFromWaitlist(sessionId: string): Promise<void> {
  try {
    await runPromotion(sessionId)
  } catch (err) {
    console.error('[promoteFromWaitlist] falhou', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'waitlist', notificationType: 'waitlist_promotion' },
      extra: { sessionId },
    })
  }
}

async function runPromotion(sessionId: string): Promise<void> {
  const adminClient = createAdminClient()

  const { data: sessionRow } = await adminClient
    .from('class_sessions')
    .select(
      'id, organization_id, session_date, status, start_time, end_time, court, max_students, class:classes(name, max_students, start_time, end_time, court)',
    )
    .eq('id', sessionId)
    .single()

  if (!sessionRow) return
  // Aula cancelada ou concluída não tem vaga a preencher.
  if (sessionRow.status !== 'scheduled') return

  const clsRaw = Array.isArray(sessionRow.class) ? sessionRow.class[0] : sessionRow.class
  const cls = clsRaw as {
    name: string
    max_students: number
    start_time: string
    end_time: string
    court: number | null
  } | null
  if (!cls) return

  const orgId = sessionRow.organization_id as string
  const sessionDate = sessionRow.session_date as string

  // Capacidade e horário DESTA data, não os da turma: aula remarcada ou com
  // capacidade ajustada muda os dois.
  const resolved = resolveSession(sessionRow as SessionOverrides, cls)
  const ref = {
    className: cls.name,
    sessionDate,
    startTime: resolved.startTime,
  }

  // Corte de 1h. Vale para a promoção inteira, então é avaliado antes de
  // qualquer leitura de fila.
  if (!canAutoEnter(sessionStartIso(sessionDate, resolved.startTime), new Date().toISOString())) {
    return
  }

  const { data: waiting } = await adminClient
    .from('waitlists')
    .select('id, student_id, first_notified_at')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
    // A ordem é joined_at, nunca a coluna `position`: ela não é recalculada e
    // fica defasada (ver features/aulas/waitlistQueries.ts).
    .order('joined_at', { ascending: true })

  const fila = (waiting ?? []) as {
    id: string
    student_id: string
    first_notified_at: string | null
  }[]
  if (fila.length === 0) return

  const { count: confirmados } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  let vagas = openSpots(resolved.maxStudents, confirmados ?? 0)

  for (const entrada of fila) {
    if (vagas === 0) break

    const membership = await getMembershipFor(adminClient, entrada.student_id, orgId)
    if (!membership) continue

    const access = await resolveStudentClassAccess(adminClient, {
      studentId: entrada.student_id,
      orgId,
      sessionDate,
      membership,
    })

    // Barrado: sai da fila e é avisado do motivo. `dailyCapExceeded` é o teto
    // diário medido fora da cota — a decisão não o cobre quando a academia tem
    // a cota desligada, então ele entra aqui explicitamente.
    const denial =
      'denied' in access.decision
        ? access.decision.denied
        : access.dailyCapExceeded
          ? ('daily_cap' as const)
          : null

    if (denial) {
      await adminClient
        .from('waitlists')
        .update({ status: 'cancelled' as WaitlistStatus })
        .eq('id', entrada.id)

      await enviar(
        adminClient,
        orgId,
        entrada.student_id,
        'waitlist_removed',
        buildRemovedFromWaitlistNotice(ref, denial, access.debtTotal),
      )
      continue
    }

    // Reserva pela porta normal: é ela que garante capacidade atômica
    // (book_session_atomic), débito de crédito, saída da fila e o ponto de Liga
    // de "pegou vaga da fila". `orgId` explícito porque aqui não há usuário
    // logado — a promoção roda no cron e no request de quem cancelou.
    // Import dinâmico: `actions.ts` importa deste módulo, então o estático
    // fecharia um ciclo. Mesmo recurso que features/checkin/missedCheckins.ts
    // já usa para chamar a fila de volta.
    const { bookSessionAs } = await import('./actions')
    const { error } = await bookSessionAs(entrada.student_id, sessionId, { orgId })
    if (error) {
      // Corrida (alguém entrou primeiro) ou recusa que a decisão não previu.
      // Não remove da fila: o lugar dele continua valendo para a próxima vaga.
      console.error('[promoteFromWaitlist] reserva recusada', {
        sessionId,
        studentId: entrada.student_id,
        error,
      })
      continue
    }

    vagas--
    await enviar(
      adminClient,
      orgId,
      entrada.student_id,
      'waitlist_auto_entered',
      buildAutoEnteredNotice(ref),
    )
  }

  await avisarNovoPrimeiro(adminClient, sessionId, orgId, ref)
}

/**
 * Avisa quem ficou na frente da fila. Uma vez por pessoa, por sessão: sem a
 * marca em `first_notified_at`, o cron de rede de segurança reavisaria o mesmo
 * aluno a cada passada.
 */
async function avisarNovoPrimeiro(
  adminClient: ReturnType<typeof createAdminClient>,
  sessionId: string,
  orgId: string,
  ref: WaitlistSessionRef,
): Promise<void> {
  const { data: restante } = await adminClient
    .from('waitlists')
    .select('id, student_id, first_notified_at')
    .eq('session_id', sessionId)
    .eq('status', 'waiting')
    .order('joined_at', { ascending: true })
    .limit(1)

  const primeiro = ((restante ?? []) as {
    id: string
    student_id: string
    first_notified_at: string | null
  }[])[0]

  if (!primeiro || primeiro.first_notified_at) return

  await adminClient
    .from('waitlists')
    .update({ first_notified_at: new Date().toISOString() })
    .eq('id', primeiro.id)

  await enviar(
    adminClient,
    orgId,
    primeiro.student_id,
    'waitlist_now_first',
    buildNowFirstNotice(ref),
  )
}

/**
 * Dispara um aviso da fila. In-app + push + e-mail, sem WhatsApp.
 *
 * Best-effort: a reserva (ou a remoção) já está gravada e não pode ser desfeita
 * porque um push falhou. O e-mail precisa do endereço de `user_emails` — aluno
 * sem login (dependente, cadastro gerenciado pela academia) não tem, e para ele
 * sobram in-app e push.
 */
async function enviar(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
  studentId: string,
  type: string,
  notice: WaitlistNotice,
): Promise<void> {
  try {
    const { data: emailRow } = await adminClient
      .from('user_emails')
      .select('email')
      .eq('id', studentId)
      .maybeSingle()

    await notifyUsers(adminClient, {
      orgId,
      recipients: [
        { userId: studentId, email: (emailRow as { email: string } | null)?.email ?? null },
      ],
      type,
      title: notice.title,
      body: notice.body,
      channels: ['inapp', 'email', 'push'],
    })
  } catch (err) {
    console.error('[promoteFromWaitlist] aviso falhou', {
      studentId,
      type,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: type },
      extra: { studentId },
    })
  }
}

// ---------------------------------------------------------------------------
// clearWaitlistEntry — tira o aluno da fila quando ele consegue entrar na aula
// ---------------------------------------------------------------------------

/**
 * Encerra a entrada ativa do aluno na fila daquela sessão. Chamado depois de um
 * agendamento bem-sucedido: entrar na aula sai da fila, por qualquer porta
 * (botão da fila ou agendamento normal). Nunca lança — a reserva já está feita
 * e não pode ser desfeita por causa da limpeza da fila.
 *
 * Devolve `true` quando o aluno REALMENTE estava na fila. É o que distingue, na
 * Liga, quem pegou uma vaga que abriu de quem agendou uma aula que estava vazia.
 */
export async function clearWaitlistEntry(
  sessionId: string,
  studentId: string,
): Promise<boolean> {
  try {
    const adminClient = createAdminClient()
    const { data } = await adminClient
      .from('waitlists')
      .update({ status: 'accepted' as WaitlistStatus })
      .eq('session_id', sessionId)
      .eq('student_id', studentId)
      .in('status', ['waiting', 'offered'])
      .select('id')
    return (data ?? []).length > 0
  } catch (err) {
    console.error('[clearWaitlistEntry] falhou', {
      sessionId, studentId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// joinWaitlist — student joins the waitlist for a full session
// ---------------------------------------------------------------------------

/**
 * Por que o aluno não pode nem entrar na fila.
 *
 * Fala de FILA, não de reserva: o aluno está tentando entrar na lista, e um
 * texto dizendo "não foi possível agendar" o deixaria procurando um agendamento
 * que ele não pediu.
 */
function describeJoinDenial(
  denial: AccessDenial,
  access: { dailyCap: number; quotaLimit: number | null; debtTotal: number },
): string {
  switch (denial) {
    case 'archived':
      return 'Seu cadastro nesta academia está inativo. Fale com a academia para voltar a agendar.'
    case 'blocked_by_debt':
      return `Você tem R$ ${access.debtTotal.toFixed(2).replace('.', ',')} em aberto. Regularize em Financeiro para entrar na fila.`
    case 'blocked_by_missed_checkins':
      return 'Você tem check-in(s) do parceiro em aberto. Regularize em Financeiro para entrar na fila.'
    case 'on_vacation':
      return 'Você tem férias aprovadas nesta data. Cancele as férias para poder entrar na fila desta aula.'
    case 'quota_exhausted':
      return `Você já usou suas ${access.quotaLimit ?? 0} aulas do ciclo. A fila coloca você na aula automaticamente, então ela precisa de aula disponível — compre uma avulsa ou cancele uma aula futura.`
    case 'daily_cap':
      return `Você já atingiu o limite de ${access.dailyCap} aulas por dia nessa data, então não pode entrar na fila desta aula.`
    default:
      return 'Não foi possível entrar na fila desta aula.'
  }
}

export async function joinWaitlist(
  sessionId: string,
): Promise<{ error?: string; position?: number }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  return joinWaitlistAs(user.id, sessionId)
}

/**
 * Entra na fila PARA `studentId`. Casca de `joinWaitlist` e porta do responsável
 * que põe o dependente na fila de uma turma kids lotada — mesma razão de
 * `bookSessionAs`: a regra é do aluno, não de quem apertou o botão.
 *
 * Autorização é do caller (features/aulas/guardianActions.ts).
 */
export async function joinWaitlistAs(
  studentId: string,
  sessionId: string,
): Promise<{ error?: string; position?: number }> {
  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Fetch session + class (escopado pela academia ativa)
  const { data: session } = await adminClient
    .from('class_sessions')
    .select(
      'id, status, session_date, max_students, start_time, end_time, court, class:classes(max_students, level, type, start_time, end_time, court)',
    )
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta sessão não está disponível.' }

  const clsInfo = (Array.isArray(session.class) ? session.class[0] : session.class) as {
    max_students: number
    level: StudentLevel
    type: ClassType
    start_time: string
    end_time: string
    court: number | null
  } | null
  if (!clsInfo) return { error: 'Turma não encontrada.' }

  // Nível/dependente/pagamento (por-academia) vêm da membership do ALUNO na
  // academia ativa — que pode ser o dependente, não quem está logado. A
  // membership inteira, e não só `is_dependent`, porque a decisão de acesso
  // abaixo precisa de crédito, parceiro e `archived_at`.
  const joinMembership = await getMembershipFor(adminClient, studentId, orgId)
  if (!joinMembership) return { error: 'Perfil não encontrado.' }

  if (clsInfo.type === 'kids' && !joinMembership.is_dependent) {
    return {
      error:
        'Turma exclusiva para alunos kids. Se você é responsável, coloque o seu dependente na fila.',
    }
  }

  // Capacidade DESTA data. A fila usa o mesmo teto do agendamento: se a aula do
  // dia foi reduzida para 4, "está cheia" e "a fila está cheia" mudam junto.
  const maxStudents = resolveSession(session as SessionOverrides, clsInfo).maxStudents

  // Confirm session is actually full
  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) < maxStudents) {
    return { error: 'Esta sessão ainda tem vagas. Use o agendamento normal.' }
  }

  // Check no existing booking
  const { count: existingBooking } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .eq('status', 'confirmed')

  if ((existingBooking ?? 0) > 0) {
    return { error: 'Você já tem um agendamento nesta sessão.' }
  }

  // Check no existing waitlist entry
  const { count: existingWaitlist } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .in('status', ['waiting', 'offered'])

  if ((existingWaitlist ?? 0) > 0) {
    return { error: 'Você já está na lista de espera desta sessão.' }
  }

  // A fila agora é entrada automática: quem está nela ENTRA na aula sozinho
  // quando a vaga abre. Então entrar na fila exige poder entrar na aula — a mesma
  // decisão da reserva, pela mesma função. Antes daqui a fila não checava nada
  // disso, e dava para entrar com dívida e só descobrir na hora da vaga.
  //
  // O estado muda depois (a dívida aparece, a cota vira), então a checagem
  // também é refeita na promoção, que remove quem deixou de poder entrar.
  const access = await resolveStudentClassAccess(adminClient, {
    studentId,
    orgId,
    sessionDate: session.session_date as string,
    membership: joinMembership,
  })

  if ('denied' in access.decision) {
    return { error: describeJoinDenial(access.decision.denied, access) }
  }
  if (access.dailyCapExceeded) {
    return {
      error: `Você já atingiu o limite de ${access.dailyCap} aulas por dia nessa data, então não pode entrar na fila desta aula.`,
    }
  }

  // Entradas mortas (saiu da fila / perdeu o prazo) de tentativas anteriores.
  // A unicidade hoje é parcial (só status ativos), mas limpar mantém o histórico
  // da sessão enxuto e evita depender da versão do índice em cada ambiente.
  await adminClient
    .from('waitlists')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .in('status', ['cancelled', 'expired'])

  // Calculate position (count of active waitlist entries + 1)
  const { count: activeCount } = await adminClient
    .from('waitlists')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .in('status', ['waiting', 'offered'])

  const position = (activeCount ?? 0) + 1

  // Check waitlist capacity (max = max_students)
  if (position > maxStudents) {
    return { error: 'A lista de espera para esta sessão está cheia.' }
  }

  const { error: insertErr } = await adminClient.from('waitlists').insert({
    organization_id: orgId,
    session_id: sessionId,
    student_id: studentId,
    position,
  })

  if (insertErr) return { error: 'Erro ao entrar na lista de espera. Tente novamente.' }

  // Confirmação de entrada na fila: sem isto o aluno só recebe notificação se e
  // quando uma vaga abrir, e fica sem saber se a entrada valeu nem que lugar pegou.
  // Best-effort — a fila já está gravada, notificação não pode derrubar a ação.
  try {
    const { data: sessionInfo } = await adminClient
      .from('class_sessions')
      .select('session_date, class:classes(name)')
      .eq('id', sessionId)
      .single()
    const clsRaw = Array.isArray(sessionInfo?.class) ? sessionInfo!.class[0] : sessionInfo?.class
    const className = (clsRaw as { name: string } | null)?.name ?? 'sua aula'

    await notifyUsers(adminClient, {
      orgId,
      recipients: [{ userId: studentId }],
      type: 'waitlist_joined',
      title: 'Você entrou na lista de espera',
      body:
        `Você é o ${position}º da fila em ${className} (${sessionInfo?.session_date}). ` +
        'Quando abrir vaga, o primeiro da fila entra na aula automaticamente e é avisado. ' +
        'Se você virar o primeiro, a gente te avisa também.',
      channels: ['inapp', 'push'],
    })
  } catch (err) {
    console.error('[joinWaitlist] notifyUsers falhou', {
      sessionId, studentId: studentId,
      error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { channel: 'dispatch', notificationType: 'waitlist_joined' },
      extra: { sessionId, studentId: studentId },
    })
  }

  revalidatePath('/home')
  revalidatePath('/agendar')
  return { position }
}

// ---------------------------------------------------------------------------
// leaveWaitlist — student voluntarily leaves the queue
// ---------------------------------------------------------------------------

export async function leaveWaitlist(waitlistId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  return leaveWaitlistAs(waitlistId, [user.id])
}

/**
 * Sai da fila em nome de alguém que o caller já autorizou — mesmo contrato de
 * `cancelBookingAs`: uma lista de ids permitidos, porque export de `'use server'`
 * é endpoint e endpoint só recebe dado serializável.
 */
export async function leaveWaitlistAs(
  waitlistId: string,
  allowedStudentIds: string[],
): Promise<{ error?: string }> {
  const adminClient = createAdminClient()

  const { data: entry } = await adminClient
    .from('waitlists')
    .select('id, student_id, status, session_id')
    .eq('id', waitlistId)
    .single()

  if (!entry) return { error: 'Entrada não encontrada.' }
  if (!allowedStudentIds.includes(entry.student_id as string)) {
    return { error: 'Sem permissão.' }
  }
  if (!['waiting', 'offered'].includes(entry.status)) {
    return { error: 'Você não está mais na lista de espera.' }
  }

  await adminClient
    .from('waitlists')
    .update({ status: 'cancelled' as WaitlistStatus })
    .eq('id', waitlistId)

  // Sem avanço de fila aqui: a vaga não fica reservada para ninguém, então sair
  // da fila não libera nada para o próximo — quem continua na fila já foi (ou
  // será) avisado quando houver vaga de verdade.

  revalidatePath('/home')
  revalidatePath('/agendar')
  return {}
}

