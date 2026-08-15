'use server'
// features/aulas/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { canCancelWithRefund, getMakeupCreditExpiry } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { resolveSession, type SessionOverrides } from '@/lib/aulas/sessionOverride'
import { notifyWaitlistSpotOpen, clearWaitlistEntry } from './waitlistActions'
import {
  awardLigaExtra,
  revokeLigaExtra,
  ENTRY_REASONS,
  EXIT_REASON,
} from '@/features/liga/extraPoints'
import { isEarlyBooking } from '@/lib/liga/points'
import { brtToday, nextDateForDayOfWeek } from '@/lib/utils/gridSchedule'
import { checkLowCreditThreshold } from './creditNotifications'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
import { syncLigaAttendancePoints } from '@/features/liga/attendancePoints'
import { resolveClassAccess, exceedsDailyCap } from '@/lib/utils/accessRules'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { summarizeDebts } from '@/lib/utils/debtRules'
import { getDebtGraceDays } from '@/features/financeiro/debtQueries'
import { getQuotaSnapshot } from './quotaUsage'
import { isQuotaEnforced, getOrgMaxClassesPerDay } from './quotaSettings'
import {
  ensureMissedCheckin,
  clearMissedCheckin,
  enforceMissedCheckinBlock,
} from '@/features/checkin/missedCheckins'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
} from '@/features/checkin/missedCheckinSettings'
import type {
  StudentLevel,
  ClassType,
  BookingStatus,
  SessionStatus,
  Membership,
  PayWith,
} from '@/types'
import * as Sentry from '@sentry/nextjs'

// A próxima ocorrência de um dia-da-semana saiu daqui para
// `nextDateForDayOfWeek` (lib/utils/gridSchedule). A versão local usava
// `getDay()`/`setDate()`, que leem o fuso do PROCESSO: na Vercel (UTC), das 21h à
// meia-noite BRT o dia-da-semana de partida já era o do dia seguinte e a sessão
// nascia uma semana adiantada. O helper opera sobre a data BRT em string.

// ---------------------------------------------------------------------------
// bookNextSession — books the next upcoming session for a class.
// Auto-creates the session if none exists for the upcoming occurrence.
// ---------------------------------------------------------------------------

export async function bookNextSession(classId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

  // Find next scheduled session (escopado pela academia ativa)
  const { data: existingSession } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('class_id', classId)
    .eq('organization_id', orgId)
    .gte('session_date', today)
    .eq('status', 'scheduled')
    .order('session_date', { ascending: true })
    .limit(1)
    .maybeSingle()

  let sessionId: string

  if (existingSession) {
    sessionId = (existingSession as { id: string }).id
  } else {
    // Auto-create the next session for this class
    const { data: cls } = await adminClient
      .from('classes')
      .select('day_of_week, is_active')
      .eq('id', classId)
      .eq('organization_id', orgId)
      .single()

    if (!cls || !cls.is_active) return { error: 'Turma não encontrada ou inativa.' }

    const sessionDate = nextDateForDayOfWeek(brtToday(new Date()), cls.day_of_week as number)

    const { data: newSession, error: createErr } = await adminClient
      .from('class_sessions')
      .insert({ organization_id: orgId, class_id: classId, session_date: sessionDate, status: 'scheduled', notes: null })
      .select('id')
      .single()

    if (createErr || !newSession) return { error: 'Erro ao preparar sessão.' }
    sessionId = (newSession as { id: string }).id
  }

  // Quem decide o custo é resolveClassAccess, dentro de bookSession.
  return bookSession(sessionId)
}

// ---------------------------------------------------------------------------
// bookSession
// ---------------------------------------------------------------------------

/**
 * Devolve à Liga os pontos que a ENTRADA na aula creditou.
 *
 * Chamado por toda saída (cancelar, faltar numa fixa, ser removido pelo
 * professor). Best-effort como o resto da Liga: nunca derruba o cancelamento.
 */
async function revokeEntryPoints(
  adminClient: ReturnType<typeof createAdminClient>,
  input: { orgId: string; studentId: string; sessionId: string; sport: string | null },
): Promise<void> {
  for (const reason of ENTRY_REASONS) {
    await revokeLigaExtra(adminClient, {
      orgId: input.orgId,
      studentId: input.studentId,
      reason,
      sourceId: input.sessionId,
      sport: input.sport,
    })
  }
}

/**
 * Membership do aluno na academia, por id explícito.
 *
 * `getActiveMembership()` só serve para o próprio usuário logado; o responsável
 * que inscreve o filho precisa da membership DO FILHO — é ela que tem o crédito,
 * o plano e o `is_dependent` que a turma kids exige.
 */
async function getMembershipFor(
  adminClient: ReturnType<typeof createAdminClient>,
  studentId: string,
  orgId: string,
): Promise<Membership | null> {
  const { data } = await adminClient
    .from('memberships')
    .select('*')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return (data as Membership) ?? null
}

/**
 * Books a class session for the current authenticated student.
 *
 * Casca fina sobre `bookSessionAs`: o aluno é o próprio usuário logado. O
 * responsável que inscreve um dependente entra pela mesma porta, com outro
 * `studentId` (features/aulas/guardianActions.ts).
 */
export async function bookSession(
  sessionId: string,
  payWith?: PayWith,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  return bookSessionAs(user.id, sessionId, { payWith })
}

/**
 * Reserva uma sessão PARA `studentId`. Toda a regra de acesso, cota, crédito e
 * dívida é resolvida na membership DELE — é o que faz o mesmo caminho servir para
 * o aluno adulto e para o dependente inscrito pelo responsável, que tem plano e
 * saldo próprios.
 *
 * Quem chama é responsável pela autorização (o aluno é você, ou você é o
 * responsável dele). Aqui só se confere o que a academia decide.
 *
 * Validações, em ordem:
 *   1. Membership do aluno na academia ativa
 *   2. Sessão existe e está agendada
 *   3. Kids: turma kids só recebe dependente
 *   4. Teto diário (0 = sem teto; ignorado quando o aluno paga com crédito)
 *   5. Sem reserva confirmada duplicada
 *   6. Capacidade e inserção atômicas via RPC book_session_atomic; débito via adjust_credits
 */
export async function bookSessionAs(
  studentId: string,
  sessionId: string,
  opts: { payWith?: PayWith } = {},
): Promise<{ error?: string }> {
  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // 1. Campos por-academia (level, is_dependent, credits_balance, payment_type)
  //    vêm da membership da academia ativa.
  const profile = await getMembershipFor(adminClient, studentId, orgId)
  if (!profile) return { error: 'Perfil não encontrado.' }

  // 2. Fetch session + class (escopado pela academia ativa)
  const { data: session, error: sessionErr } = await adminClient
    .from('class_sessions')
    .select(
      'id, class_id, session_date, status, start_time, end_time, court, max_students, class:classes(id, level, type, max_students, name, sport, start_time, end_time, court)',
    )
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()
  if (sessionErr || !session) return { error: 'Sessão não encontrada.' }

  const sessionStatus = session.status as SessionStatus
  if (sessionStatus !== 'scheduled') {
    return { error: 'Esta sessão não está disponível para agendamento.' }
  }

  const clsRaw = Array.isArray(session.class) ? session.class[0] : session.class
  const cls = clsRaw as {
    id: string
    level: StudentLevel
    type: ClassType
    max_students: number
    name: string
    sport: string | null
    start_time: string
    end_time: string
    court: number | null
  }

  // Capacidade DESTA data: a aula remarcada pode ter mais ou menos vagas que a
  // turma. Ler classes.max_students direto era o furo — o override existiria no
  // banco e o agendamento continuaria usando o teto antigo.
  const resolved = resolveSession(session as SessionOverrides, cls)

  // 3. Kids check. A turma kids passou a APARECER para o adulto (ele precisa ver a
  //    aula do filho na agenda da arena), mas continua fechada para ele — quem entra
  //    é o dependente, pela porta do responsável.
  if (cls.type === 'kids' && !profile.is_dependent) {
    return {
      error:
        'Turma exclusiva para alunos kids. Se você é responsável, inscreva o seu dependente na ficha da aula.',
    }
  }

  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1).
  // getActivePlan devolve a configuração de cota, não só o sim/não — a cota
  // precisa de classes_per_week, cycle e max_classes_per_day.
  const plan = await getActivePlan(adminClient, studentId, orgId)
  const hasActivePlan = plan !== null

  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)

  // Aula paga com crédito não gasta plano, então nem cota nem teto diário valem
  // para ela. A preferência só existe de fato se houver saldo — sem crédito, o
  // pedido é ignorado e a regra normal volta a decidir.
  const preferCredit = opts.payWith === 'credit' && profile.credits_balance >= 1

  // Só paga o custo das duas queries da cota quando a academia ligou a regra e a
  // cota ainda importa para esta reserva.
  const snapshot =
    quotaEnforced && plan && !preferCredit
      ? await getQuotaSnapshot(adminClient, studentId, orgId, plan, session.session_date)
      : null

  // Teto diário efetivo: o do plano do aluno, ou o padrão da academia quando
  // não há plano ativo. Usado tanto no check inline abaixo quanto no
  // resolveClassAccess mais adiante — nunca recalculado duas vezes.
  // 0 = sem teto (ver exceedsDailyCap).
  const dailyCap = plan?.maxClassesPerDay ?? orgDailyCap

  // 4. Daily limit. Esta checagem roda mesmo com a cota desligada, então ela também
  //    precisa respeitar o teto 0 e a escolha do crédito — senão o aluno seria
  //    barrado aqui, antes de resolveClassAccess sequer opinar.
  if (!preferCredit && dailyCap > 0) {
    const { count: dailyCount } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .in(
        'session_id',
        (
          await adminClient
            .from('class_sessions')
            .select('id')
            .eq('organization_id', orgId)
            .eq('session_date', session.session_date)
        ).data?.map((s: { id: string }) => s.id) ?? [],
      )

    if (exceedsDailyCap(dailyCount ?? 0, dailyCap)) {
      return {
        error:
          profile.credits_balance >= 1
            ? `Limite de ${dailyCap} aulas por dia atingido. Você pode entrar usando 1 crédito avulso.`
            : `Você já atingiu o limite de ${dailyCap} aulas por dia nessa data.`,
      }
    }
  }

  // 5. Duplicate check
  const { count: dupCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((dupCount ?? 0) > 0) {
    return { error: 'Você já possui um agendamento confirmado nesta sessão.' }
  }

  // Dívida aberta = payments pendente COM session_id. O filtro de session_id é
  // essencial: compra de crédito abandonada no checkout também fica 'pending',
  // mas com session_id null — sem o filtro ela bloquearia o aluno para sempre
  // (spec §4). Desde 2026-07-22, ter pendência não basta: precisa ter valor e
  // ter passado a carência (spec cobrança §2) — senão uma dívida de R$ 0
  // (academia sem preço configurado) travava o aluno indefinidamente.
  const { data: debtRows } = await adminClient
    .from('payments')
    .select('id, amount, created_at, receipt_url')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    // A pendência de check-in também vive em payments, mas tem regra própria
    // (limite de contagem, não carência). Sem este filtro a mesma falta bloquearia
    // por dois caminhos, um deles não configurado pela academia.
    .eq('missed_checkin', false)

  const graceDays = await getDebtGraceDays(adminClient, orgId)
  const debtSummary = summarizeDebts(
    ((debtRows ?? []) as { id: string; amount: number; created_at: string; receipt_url: string | null }[])
      .map((r) => ({ id: r.id, amount: Number(r.amount), createdAt: r.created_at, receiptUrl: r.receipt_url })),
    graceDays,
    new Date(),
  )

  // Pendência de check-in do parceiro. Só busca para quem tem parceiro — é o único
  // aluno que pode ter pendência, e este é o caminho quente de toda reserva.
  const { blockLimit: missedCheckinBlockLimit } = profile.partner
    ? await getMissedCheckinSettings(adminClient, orgId)
    : { blockLimit: 0 }
  const openMissedCheckins =
    profile.partner && missedCheckinBlockLimit > 0
      ? await countOpenMissedCheckins(adminClient, studentId, orgId)
      : 0

  const decision = resolveClassAccess({
    archived: Boolean(profile.archived_at),
    partner: profile.partner,
    hasActivePlan,
    creditsBalance: profile.credits_balance,
    hasOpenDebt: debtSummary.isBlocked,
    openMissedCheckins,
    missedCheckinBlockLimit,
    quotaEnforced,
    quotaRemaining: snapshot?.remaining ?? null,
    bookingsOnDate: snapshot?.bookingsOnDate ?? 0,
    maxClassesPerDay: dailyCap,
    preferCredit,
  })

  if ('denied' in decision) {
    // As duas negações de cota deixam de ser beco sem saída quando o aluno tem
    // crédito comprado: dizer só "acabou" esconde o caminho que existe.
    const comCredito = profile.credits_balance >= 1
    if (decision.denied === 'daily_cap') {
      return {
        error: comCredito
          ? `Você já tem ${dailyCap} aulas reservadas neste dia. Pode entrar usando 1 crédito avulso.`
          : `Você já tem ${dailyCap} aulas reservadas neste dia. É o limite do seu plano.`,
      }
    }
    if (decision.denied === 'quota_exhausted') {
      const periodo = plan?.cycle === 'weekly' ? 'desta semana' : 'deste mês'
      return {
        error: comCredito
          ? `Você já usou suas ${snapshot?.limit ?? 0} aulas ${periodo}. Pode entrar usando 1 crédito avulso.`
          : `Você já usou suas ${snapshot?.limit ?? 0} aulas ${periodo}. Cancele uma aula futura ou compre uma avulsa.`,
      }
    }
    if (decision.denied === 'archived') {
      return { error: 'Seu cadastro nesta academia está inativo. Fale com a academia para voltar a agendar.' }
    }
    if (decision.denied === 'blocked_by_missed_checkins') {
      return {
        error: `Você tem ${openMissedCheckins} check-in(s) do parceiro em aberto. Regularize em Financeiro para voltar a agendar.`,
      }
    }
    return {
      error: `Você tem R$ ${debtSummary.total.toFixed(2).replace('.', ',')} em aberto. Regularize em Financeiro para voltar a agendar.`,
    }
  }

  // Só 'credit' debita. 'partner' e 'plan' entram de graça; 'debt' entra e a
  // pendência nasce se houver presença (spec §5).
  const useCredit = decision.grant === 'credit'

  // Capacity check + insert na mesma transação (sem overbooking)
  const { data: bookingId, error: bookErr } = await adminClient.rpc('book_session_atomic', {
    p_student_id: studentId,
    p_session_id: sessionId,
    p_max_students: resolved.maxStudents,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) {
      // Corrida da fila de espera: todo mundo é avisado quando abre vaga, então
      // quem chega depois do último lugar precisa saber que continua na fila —
      // e não que perdeu o lugar.
      const { count: onWaitlist } = await adminClient
        .from('waitlists')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('student_id', studentId)
        .in('status', ['waiting', 'offered'])

      return {
        error:
          (onWaitlist ?? 0) > 0
            ? 'Alguém entrou primeiro e a vaga foi preenchida. Você continua na fila.'
            : 'Esta turma está lotada.',
      }
    }
    if (bookErr.message.includes('ALREADY_BOOKED')) return { error: 'Você já possui um agendamento confirmado nesta sessão.' }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  // Débito atômico (transação + saldo juntos)
  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: -1,
      p_type: 'used',
      p_reason: `Agendamento avulso: ${cls.name} (${session.session_date})`,
      p_session_id: sessionId,
    })

    if (creditErr) {
      // Desfaz o booking se o débito falhou (saldo esgotado em corrida)
      const { error: rollbackErr } = await adminClient
        .from('session_bookings')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', bookingId as string)

      if (rollbackErr) {
        console.error('[bookSession] rollback do booking falhou após erro no débito', {
          bookingId,
          creditErr: creditErr.message,
          rollbackErr: rollbackErr.message,
        })
      }

      return creditErr.message.includes('INSUFFICIENT_CREDITS')
        ? { error: 'Créditos insuficientes.' }
        : { error: 'Erro ao criar agendamento. Tente novamente.' }
    }

    // Aviso de credito baixo (best-effort; a funcao nunca lança).
    await checkLowCreditThreshold(adminClient, studentId, orgId, -1)
  }

  // Entrou na aula: sai da fila de espera. Vale para qualquer porta de entrada —
  // o botão da fila e o agendamento normal passam os dois por aqui.
  const veioDaFila = await clearWaitlistEntry(sessionId, studentId)

  // Liga: pegar vaga da fila e agendar com antecedência são coisas diferentes, e o
  // aluno recebe uma OU outra. Somar as duas premiaria duas vezes a mesma reserva.
  if (orgId) {
    // Voltar para a aula devolve o ponto de tê-la liberado. Sem isto, sair e
    // entrar de novo era lucro: o crédito da saída ficava, e a entrada creditava
    // por cima.
    await revokeLigaExtra(adminClient, {
      orgId,
      studentId,
      reason: EXIT_REASON,
      sourceId: sessionId,
      sport: cls.sport ?? null,
    })

    if (veioDaFila) {
      await awardLigaExtra(adminClient, {
        orgId,
        studentId: studentId,
        reason: 'waitlist_accept',
        sourceId: sessionId,
        sport: cls.sport ?? null,
      })
    } else if (isEarlyBooking(brtToday(new Date()), session.session_date)) {
      await awardLigaExtra(adminClient, {
        orgId,
        studentId: studentId,
        reason: 'early_booking',
        sourceId: sessionId,
        sport: cls.sport ?? null,
      })
    }
  }

  revalidatePath('/home')
  revalidatePath('/agendar')
  revalidatePath('/aulas')
  return {}
}

// ---------------------------------------------------------------------------
// skipEnrollmentSession — fixed student skips one specific session.
// Refunds 1 non-expiring credit if one was originally consumed for this
// booking, regardless of timing. Does NOT cancel the enrollment (student
// stays fixed for future weeks).
// ---------------------------------------------------------------------------

export async function skipEnrollmentSession(bookingId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const { data: booking } = await adminClient
    .from('session_bookings')
    .select('id, student_id, session_id, status, credit_used, from_enrollment, organization_id')
    .eq('id', bookingId)
    .single()

  if (!booking) return { error: 'Agendamento não encontrado.' }
  if (booking.student_id !== user.id) return { error: 'Sem permissão.' }
  if (booking.status !== 'confirmed') return { error: 'Este agendamento já foi cancelado.' }
  if (!booking.from_enrollment) return { error: 'Use o cancelamento normal para aulas avulsas.' }

  const now = new Date().toISOString()

  const { error: cancelErr } = await adminClient
    .from('session_bookings')
    .update({ status: 'cancelled' as BookingStatus, cancelled_at: now })
    .eq('id', bookingId)

  if (cancelErr) return { error: 'Erro ao cancelar. Tente novamente.' }

  let creditWarning: string | undefined
  if (booking.credit_used) {
    // Aluno fixo que consumiu crédito recebe crédito de reposição sem vencimento ao sair de uma aula
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: user.id,
      p_org: booking.organization_id,
      p_delta: 1,
      p_type: 'refunded',
      p_reason: 'Falta em aula fixa: crédito reposição sem vencimento',
      p_session_id: booking.session_id,
    })
    if (creditErr) {
      console.error('[skipEnrollmentSession] adjust_credits falhou', {
        bookingId, sessionId: booking.session_id, error: creditErr.message,
      })
      creditWarning = 'Saída registrada, mas houve um erro ao gerar o crédito. Contate o suporte.'
    }
  }

  // Open spot for next person on waitlist
  await notifyWaitlistSpotOpen(booking.session_id)

  // Liga: sair da aula devolve o ponto que a entrada rendeu, por qualquer porta.
  // O esporte vem da turma para casar com o que a entrada creditou.
  const { data: skipSession } = await adminClient
    .from('class_sessions')
    .select('class:classes(sport)')
    .eq('id', booking.session_id)
    .single()
  const skipCls = Array.isArray(skipSession?.class) ? skipSession!.class[0] : skipSession?.class
  await revokeEntryPoints(adminClient, {
    orgId: booking.organization_id as string,
    studentId: user.id,
    sessionId: booking.session_id as string,
    sport: (skipCls as { sport: string | null } | null)?.sport ?? null,
  })

  revalidatePath('/home')
  revalidatePath('/agendar')
  revalidatePath('/aulas')
  return creditWarning ? { error: creditWarning } : {}
}

// ---------------------------------------------------------------------------
// skipEnrollmentNoBooking — enrolled student skips the next session when no
// booking has been generated yet (pre-emptive skip, no credit deducted).
// Creates a cancelled booking record so future reconciliation (reconcileEnrollmentCredits) skips them.
// ---------------------------------------------------------------------------

export async function skipEnrollmentNoBooking(classId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Verify student is enrolled (na academia ativa)
  const { count: enrolled } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('class_id', classId)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  if ((enrolled ?? 0) === 0) return { error: 'Você não está matriculado nesta turma.' }

  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

  // Find or create the next session (escopado pela academia ativa)
  const { data: existingSession } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('class_id', classId)
    .eq('organization_id', orgId)
    .gte('session_date', today)
    .eq('status', 'scheduled')
    .order('session_date', { ascending: true })
    .limit(1)
    .maybeSingle()

  let sessionId: string

  if (existingSession) {
    sessionId = (existingSession as { id: string }).id
  } else {
    const { data: cls } = await adminClient
      .from('classes')
      .select('day_of_week')
      .eq('id', classId)
      .eq('organization_id', orgId)
      .single()
    if (!cls) return { error: 'Turma não encontrada.' }

    const nextDate = nextDateForDayOfWeek(brtToday(new Date()), cls.day_of_week as number)
    const { data: newSess, error: createErr } = await adminClient
      .from('class_sessions')
      .insert({ organization_id: orgId, class_id: classId, session_date: nextDate, status: 'scheduled', notes: null })
      .select('id')
      .single()
    if (createErr || !newSess) return { error: 'Erro ao preparar sessão.' }
    sessionId = (newSess as { id: string }).id
  }

  // Check no existing confirmed booking
  const { count: existing } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((existing ?? 0) > 0) {
    return { error: 'Você já tem um agendamento confirmado. Use "Sair desta aula" normal.' }
  }

  // Create a cancelled booking to mark the skip (no credit deducted/returned).
  // Upsert handles the case where a cancelled row already exists (unique constraint on student_id,session_id).
  await adminClient.from('session_bookings').upsert(
    {
      organization_id: orgId,
      student_id: user.id,
      session_id: sessionId,
      type: 'extra',
      status: 'cancelled',
      from_enrollment: true,
      credit_used: false,
      cancelled_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id' },
  )

  revalidatePath('/home')
  revalidatePath('/agendar')
  return {}
}

// ---------------------------------------------------------------------------
// skipEnrollmentForSession — mesmo opt-out preventivo do skipEnrollmentNoBooking,
// mas numa sessão escolhida. O outro sempre mira a PRÓXIMA sessão da turma, o
// que erraria a data quando o aluno recusa uma aula mais adiante na agenda.
// ---------------------------------------------------------------------------

export async function skipEnrollmentForSession(sessionId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, class_id, status')
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }
  if (session.status !== 'scheduled') return { error: 'Esta aula não está mais aberta.' }

  const { count: enrolled } = await adminClient
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('class_id', session.class_id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  if ((enrolled ?? 0) === 0) return { error: 'Você não está matriculado nesta turma.' }

  const { count: existing } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((existing ?? 0) > 0) {
    return { error: 'Você já tem um agendamento confirmado. Use "Sair desta aula".' }
  }

  // Reserva cancelada marca o opt-out; a reconciliação respeita e não reativa.
  const { error: upsertErr } = await adminClient.from('session_bookings').upsert(
    {
      organization_id: orgId,
      student_id: user.id,
      session_id: sessionId,
      type: 'extra',
      status: 'cancelled',
      from_enrollment: true,
      credit_used: false,
      cancelled_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id' },
  )
  if (upsertErr) return { error: 'Erro ao registrar a falta. Tente novamente.' }

  revalidatePath('/home')
  revalidatePath('/agendar')
  revalidatePath('/aulas')
  return {}
}

// ---------------------------------------------------------------------------
// cancelBooking
// ---------------------------------------------------------------------------

/**
 * Cancels a session booking for the current authenticated student.
 *
 * If cancellation is ≥5h before the session start:
 *   - Generates a makeup credit (type = 'refunded') if credit_used = true
 *   - Expiry = system_settings.credit_expiry_days (default 30)
 */
export async function cancelBooking(bookingId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  return cancelBookingAs(bookingId, [user.id])
}

/**
 * Cancela a reserva de alguém que o caller já autorizou.
 *
 * `allowedStudentIds` é a lista de alunos em nome de quem o caller pode agir: o
 * próprio usuário, ou os dependentes do responsável. Uma lista, e não um callback,
 * porque toda função exportada de um arquivo `'use server'` é um endpoint — e
 * endpoint só recebe dado serializável.
 *
 * É o único ponto em que o aluno e o responsável divergem: a regra de estorno, de
 * falta e de Liga é a mesma para os dois, e duplicá-la era o caminho certo para as
 * duas versões desandarem.
 */
export async function cancelBookingAs(
  bookingId: string,
  allowedStudentIds: string[],
): Promise<{ error?: string }> {
  const adminClient = createAdminClient()

  // Fetch booking
  const { data: booking, error: bookingErr } = await adminClient
    .from('session_bookings')
    .select(
      'id, student_id, session_id, status, credit_used, from_enrollment, organization_id, booked_at',
    )
    .eq('id', bookingId)
    .single()

  if (bookingErr || !booking) return { error: 'Agendamento não encontrado.' }
  if (!allowedStudentIds.includes(booking.student_id as string)) {
    return { error: 'Sem permissão.' }
  }
  if (booking.status !== 'confirmed') return { error: 'Este agendamento já foi cancelado.' }

  const studentId = booking.student_id as string

  // Fetch session + class for start time
  const { data: session } = await adminClient
    .from('class_sessions')
    .select(
      'id, session_date, start_time, end_time, court, max_students, class:classes(start_time, end_time, court, max_students, sport)',
    )
    .eq('id', booking.session_id)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }

  const clsCancel = Array.isArray(session.class) ? session.class[0] : session.class
  const cls = clsCancel as {
    start_time: string
    end_time: string
    court: number | null
    max_students: number
    sport: string | null
  }
  // Janela de cancelamento contra o horário DESTA data: a aula adiantada encurta
  // a janela e a adiada alarga. Usar o horário da turma perdoaria (ou puniria)
  // quem cancelou olhando o horário que o app mostrou.
  const sessionStart = sessionStartIso(
    session.session_date,
    resolveSession(session as SessionOverrides, cls).startTime,
  )

  const now = new Date().toISOString()
  // A janela de arrependimento entra aqui junto da regra das 5h: quem acabou de
  // entrar tem 1h para desistir sem perder o crédito nem levar falta.
  const refundEligible = canCancelWithRefund(
    sessionStart,
    now,
    undefined,
    (booking.booked_at as string | null) ?? undefined,
  )

  // Cancel booking
  const { error: cancelErr } = await adminClient
    .from('session_bookings')
    .update({
      status: 'cancelled' as BookingStatus,
      cancelled_at: now,
    })
    .eq('id', bookingId)

  if (cancelErr) return { error: 'Erro ao cancelar. Tente novamente.' }

  // Credit logic: extra (non-expiring) for fixed enrollment; makeup (30 days) for paid avulso
  let creditWarning: string | undefined
  if (refundEligible) {
    // payment_type é por-academia: lê da membership da academia do booking.
    const { data: profile } = await adminClient
      .from('memberships')
      .select('payment_type')
      .eq('user_id', studentId)
      .eq('organization_id', booking.organization_id)
      .single()

    if (profile) {
      if (booking.from_enrollment && booking.credit_used && profile.payment_type === 'subscriber') {
        // Crédito extra: não expira enquanto o contrato estiver ativo
        const { error: creditErr } = await adminClient.rpc('adjust_credits', {
          p_student_id: studentId,
          p_org: booking.organization_id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento de aula fixa: crédito extra (${session.session_date})`,
          p_session_id: booking.session_id,
        })
        if (creditErr) {
          console.error('[cancelBooking] adjust_credits falhou', {
            bookingId, sessionId: booking.session_id, error: creditErr.message,
          })
          creditWarning = 'Aula cancelada, mas houve um erro ao gerar o crédito. Contate o suporte.'
        }
      } else if (booking.credit_used) {
        // Crédito de reposição: expira em N dias
        let expiryDays = 30
        const { data: settingRow } = await adminClient
          .from('system_settings')
          .select('value')
          .eq('organization_id', booking.organization_id)
          .eq('key', 'credit_expiry_days')
          .maybeSingle()
        if (settingRow?.value) expiryDays = Number(settingRow.value)

        const expiry = getMakeupCreditExpiry(new Date(), expiryDays)
        const { error: creditErr } = await adminClient.rpc('adjust_credits', {
          p_student_id: studentId,
          p_org: booking.organization_id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento com reposição: sessão ${session.session_date}`,
          p_session_id: booking.session_id,
          p_expires_at: expiry.toISOString(),
        })
        if (creditErr) {
          console.error('[cancelBooking] adjust_credits falhou', {
            bookingId, sessionId: booking.session_id, error: creditErr.message,
          })
          creditWarning = 'Aula cancelada, mas houve um erro ao gerar o crédito. Contate o suporte.'
        }
      }
    }
  }

  // Notify next person on waitlist if any
  await notifyWaitlistSpotOpen(booking.session_id)

  // Liga. Sair da aula devolve o ponto que a ENTRADA rendeu — a antecedência que
  // foi premiada deixou de existir. Isso vale sempre, dentro ou fora da janela.
  await revokeEntryPoints(adminClient, {
    orgId: booking.organization_id as string,
    studentId,
    sessionId: booking.session_id as string,
    sport: cls.sport ?? null,
  })

  // Cancelar DENTRO da janela é o que libera a vaga a tempo de outro aluno pegar.
  // Cancelar em cima da hora não pontua — seria premiar o furo. O `sport` vai
  // explícito: sem ele isto caía no esporte principal do aluno e podia creditar
  // num ranking diferente do que a entrada usou, deixando a revogação sem alvo.
  if (refundEligible) {
    await awardLigaExtra(adminClient, {
      orgId: booking.organization_id,
      studentId: studentId,
      reason: 'cancel_in_time',
      sourceId: booking.session_id,
      sport: cls.sport ?? null,
    })
  }

  revalidatePath('/home')
  revalidatePath('/agendar')
  revalidatePath('/aulas')
  return creditWarning ? { error: creditWarning } : {}
}

// ---------------------------------------------------------------------------
// markAttendance (admin)
// ---------------------------------------------------------------------------

/** Efeito da marcação sobre a pendência de check-in, para a chamada dar feedback. */
export interface MissedCheckinEffect {
  openCount: number
  blocked: boolean
  cancelledBookings: number
}

/**
 * Marks or updates attendance for a student in a session. Admin only.
 */
export async function markAttendance(
  sessionId: string,
  studentId: string,
  present: boolean,
): Promise<{ error?: string; missed?: MissedCheckinEffect }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // Verify caller is admin na academia ativa (papel vive na membership).
  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  // Upsert attendance
  const { error: upsertErr } = await adminClient.from('attendance').upsert(
    {
      organization_id: orgId,
      student_id: studentId,
      session_id: sessionId,
      status: present ? 'present' : 'absent',
      source: 'manual',
      checked_in_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id' },
  )

  if (upsertErr) return { error: 'Erro ao registrar presença.' }

  // A dívida nasce na presença (spec §5). Só para 'present' — faltar não gera
  // cobrança. Best-effort: a pendência NUNCA derruba a marcação de presença,
  // que é a operação que o professor está fazendo.
  if (present) {
    try {
      await ensureClassDebt(adminClient, { orgId, studentId, sessionId })
    } catch (err) {
      console.error('[markAttendance] ensureClassDebt falhou', {
        sessionId, studentId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, { tags: { feature: 'classDebt' }, extra: { sessionId, studentId, orgId } })
    }
  }

  // Liga: presente credita, ausente revoga. Best-effort, igual à dívida acima.
  await syncLigaAttendancePoints(adminClient, { orgId, studentId, sessionId, present })

  // A pendência de CHECK-IN é o espelho: nasce na FALTA do aluno de parceiro, que é
  // quando a academia perde o repasse. Mesmo best-effort da dívida.
  const missed = await syncMissedCheckin(adminClient, { orgId, studentId, sessionId, present })

  return missed ? { missed } : {}
}

/**
 * Reflete a marcação de presença na pendência de check-in do aluno de parceiro.
 *
 * Ausente → cria a pendência e aplica o bloqueio se estourou o limite.
 * Presente → desfaz a pendência (o professor corrigiu a marcação).
 *
 * Nunca lança: a marcação de presença é a operação do professor e não pode falhar
 * porque a contabilidade do parceiro falhou.
 */
async function syncMissedCheckin(
  adminClient: ReturnType<typeof createAdminClient>,
  input: { orgId: string; studentId: string; sessionId: string; present: boolean },
): Promise<MissedCheckinEffect | undefined> {
  const { orgId, studentId, sessionId, present } = input

  try {
    if (present) {
      await clearMissedCheckin(adminClient, { orgId, studentId, sessionId })
      return undefined
    }

    const { data: session } = await adminClient
      .from('class_sessions')
      .select('session_date')
      .eq('id', sessionId)
      .eq('organization_id', orgId)
      .maybeSingle()

    const sessionDate = (session as { session_date: string } | null)?.session_date
    if (!sessionDate) return undefined

    const { created, openCount } = await ensureMissedCheckin(adminClient, {
      orgId, studentId, sessionId, sessionDate, createdBy: null,
    })
    if (openCount === 0) return undefined

    const { blocked, cancelledBookings } = await enforceMissedCheckinBlock(adminClient, {
      orgId, studentId,
    })

    // created=false com openCount>0 = pendência já existia (marcação repetida):
    // ainda vale informar o total em aberto na chamada.
    void created
    return { openCount, blocked, cancelledBookings }
  } catch (err) {
    console.error('[markAttendance] pendência de check-in falhou', {
      sessionId, studentId, error: err instanceof Error ? err.message : String(err),
    })
    Sentry.captureException(err, {
      tags: { feature: 'missedCheckins' },
      extra: { sessionId, studentId, orgId },
    })
    return undefined
  }
}

// ---------------------------------------------------------------------------
// markAttendanceBulk (admin)
// ---------------------------------------------------------------------------

/**
 * Bulk upserts attendance for all students in a session and marks session as completed. Admin only.
 */
export async function markAttendanceBulk(
  sessionId: string,
  allStudentIds: string[],
  presentIds: string[],
): Promise<{ error?: string; missedByStudent?: Record<string, MissedCheckinEffect> }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (membership?.role !== 'admin') return { error: 'Sem permissão.' }

  const now = new Date().toISOString()
  const presentSet = new Set(presentIds)

  const rows = allStudentIds.map((studentId) => ({
    organization_id: orgId,
    session_id: sessionId,
    student_id: studentId,
    status: presentSet.has(studentId) ? 'present' : 'absent' as 'present' | 'absent',
    source: 'manual' as const,
    checked_in_at: now,
  }))

  const { error } = await adminClient
    .from('attendance')
    .upsert(rows, { onConflict: 'session_id,student_id' })

  if (error) return { error: error.message }

  // Mesma regra do markAttendance: só quem esteve presente gera pendência.
  // Sequencial de propósito — o volume é uma turma (~15 alunos) e o índice
  // único já protege contra duplicata.
  for (const studentId of presentIds) {
    try {
      await ensureClassDebt(adminClient, { orgId, studentId, sessionId })
    } catch (err) {
      console.error('[markAttendanceBulk] ensureClassDebt falhou', {
        sessionId, studentId, error: err instanceof Error ? err.message : String(err),
      })
      Sentry.captureException(err, { tags: { feature: 'classDebt' }, extra: { sessionId, studentId, orgId } })
    }
  }

  // Espelho da dívida: quem FALTOU e é de parceiro gera pendência de check-in; quem
  // esteve presente tem a pendência daquela aula desfeita (correção de marcação).
  const missedByStudent: Record<string, MissedCheckinEffect> = {}
  for (const studentId of allStudentIds) {
    await syncLigaAttendancePoints(adminClient, {
      orgId, studentId, sessionId, present: presentSet.has(studentId),
    })
    const effect = await syncMissedCheckin(adminClient, {
      orgId, studentId, sessionId, present: presentSet.has(studentId),
    })
    if (effect) missedByStudent[studentId] = effect
  }

  await adminClient.from('class_sessions').update({ status: 'completed' }).eq('id', sessionId)

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/admin/grade/${sessionId}`)
  return Object.keys(missedByStudent).length > 0 ? { missedByStudent } : {}
}
