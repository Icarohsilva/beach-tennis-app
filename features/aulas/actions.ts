'use server'
// features/aulas/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { canCancelWithRefund, getMakeupCreditExpiry } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { offerWaitlistSpot } from './waitlistActions'
import { checkLowCreditThreshold } from './creditNotifications'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
import { resolveClassAccess } from '@/lib/utils/accessRules'
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
import type { StudentLevel, ClassType, BookingStatus, SessionStatus } from '@/types'
import * as Sentry from '@sentry/nextjs'

// ---------------------------------------------------------------------------
// getNextOccurrence — returns the next date (>= from) matching dayOfWeek
// ---------------------------------------------------------------------------

function getNextOccurrence(from: Date, dayOfWeek: number): Date {
  const date = new Date(from)
  const currentDay = date.getDay()
  let daysUntil = dayOfWeek - currentDay
  if (daysUntil < 0) daysUntil += 7
  date.setDate(date.getDate() + daysUntil)
  return date
}

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
  const today = new Date().toISOString().slice(0, 10)

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

    const nextDate = getNextOccurrence(new Date(), cls.day_of_week as number)
    const sessionDate = nextDate.toISOString().slice(0, 10)

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
 * Books a class session for the current authenticated student.
 *
 * Validations (in order):
 *   1. Student exists
 *   2. Session exists and is scheduled
 *   3. Kids check: turma kids → student must be a dependent
 *   4. Daily limit: confirmed bookings on the same date must stay under the
 *      student's plan cap (max_classes_per_day), falling back to the org's
 *      configured daily cap when there's no active plan
 *   5. No duplicate confirmed booking on the same session
 *   6. Capacidade e inserção atômicas via RPC book_session_atomic; débito via adjust_credits
 */
export async function bookSession(sessionId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  // 1. Campos por-academia (level, is_dependent, credits_balance, payment_type)
  //    vêm da membership da academia ativa.
  const profile = await getActiveMembership()
  if (!profile) return { error: 'Perfil não encontrado.' }

  // 2. Fetch session + class (escopado pela academia ativa)
  const { data: session, error: sessionErr } = await adminClient
    .from('class_sessions')
    .select('id, class_id, session_date, status, class:classes(id, level, type, max_students, name)')
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
  }

  // 3. Kids check
  if (cls.type === 'kids' && !profile.is_dependent) {
    return { error: 'Esta turma é exclusiva para alunos kids (dependentes).' }
  }

  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1).
  // getActivePlan devolve a configuração de cota, não só o sim/não — a cota
  // precisa de classes_per_week, cycle e max_classes_per_day.
  const plan = await getActivePlan(adminClient, user.id, orgId)
  const hasActivePlan = plan !== null

  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)

  // Só paga o custo das duas queries da cota quando a academia ligou a regra.
  const snapshot =
    quotaEnforced && plan
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, session.session_date)
      : null

  // Teto diário efetivo: o do plano do aluno, ou o padrão da academia quando
  // não há plano ativo. Usado tanto no check inline abaixo quanto no
  // resolveClassAccess mais adiante — nunca recalculado duas vezes.
  const dailyCap = plan?.maxClassesPerDay ?? orgDailyCap

  // 4. Daily limit
  const { count: dailyCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
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

  if ((dailyCount ?? 0) >= dailyCap) {
    return { error: `Você já atingiu o limite de ${dailyCap} aulas por dia nessa data.` }
  }

  // 5. Duplicate check
  const { count: dupCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
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
    .eq('student_id', user.id)
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
      ? await countOpenMissedCheckins(adminClient, user.id, orgId)
      : 0

  const decision = resolveClassAccess({
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
  })

  if ('denied' in decision) {
    if (decision.denied === 'daily_cap') {
      return { error: `Você já tem ${dailyCap} aulas reservadas neste dia — é o limite do seu plano.` }
    }
    if (decision.denied === 'quota_exhausted') {
      const periodo = plan?.cycle === 'weekly' ? 'desta semana' : 'deste mês'
      return {
        error: `Você já usou suas ${snapshot?.limit ?? 0} aulas ${periodo}. Cancele uma aula futura ou compre uma avulsa.`,
      }
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
    p_student_id: user.id,
    p_session_id: sessionId,
    p_max_students: cls.max_students,
    p_credit_used: useCredit,
  })

  if (bookErr) {
    if (bookErr.message.includes('SESSION_FULL')) return { error: 'Esta turma está lotada.' }
    if (bookErr.message.includes('ALREADY_BOOKED')) return { error: 'Você já possui um agendamento confirmado nesta sessão.' }
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  // Débito atômico (transação + saldo juntos)
  if (useCredit) {
    const { error: creditErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: user.id,
      p_org: orgId,
      p_delta: -1,
      p_type: 'used',
      p_reason: `Agendamento avulso — ${cls.name} (${session.session_date})`,
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
    await checkLowCreditThreshold(adminClient, user.id, orgId, -1)
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
      p_reason: 'Falta em aula fixa — crédito reposição sem vencimento',
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
  await offerWaitlistSpot(booking.session_id)

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

  const today = new Date().toISOString().slice(0, 10)

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

    const nextDate = getNextOccurrence(new Date(), cls.day_of_week as number)
    const { data: newSess, error: createErr } = await adminClient
      .from('class_sessions')
      .insert({ organization_id: orgId, class_id: classId, session_date: nextDate.toISOString().slice(0, 10), status: 'scheduled', notes: null })
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

  const adminClient = createAdminClient()

  // Fetch booking
  const { data: booking, error: bookingErr } = await adminClient
    .from('session_bookings')
    .select('id, student_id, session_id, status, credit_used, from_enrollment, organization_id')
    .eq('id', bookingId)
    .single()

  if (bookingErr || !booking) return { error: 'Agendamento não encontrado.' }
  if (booking.student_id !== user.id) return { error: 'Sem permissão.' }
  if (booking.status !== 'confirmed') return { error: 'Este agendamento já foi cancelado.' }

  // Fetch session + class for start time
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('id, session_date, class:classes(start_time)')
    .eq('id', booking.session_id)
    .single()

  if (!session) return { error: 'Sessão não encontrada.' }

  const clsCancel = Array.isArray(session.class) ? session.class[0] : session.class
  const cls = clsCancel as { start_time: string }
  const sessionStart = sessionStartIso(session.session_date, cls.start_time)

  const now = new Date().toISOString()
  const refundEligible = canCancelWithRefund(sessionStart, now)

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
      .eq('user_id', user.id)
      .eq('organization_id', booking.organization_id)
      .single()

    if (profile) {
      if (booking.from_enrollment && booking.credit_used && profile.payment_type === 'subscriber') {
        // Crédito extra: não expira enquanto o contrato estiver ativo
        const { error: creditErr } = await adminClient.rpc('adjust_credits', {
          p_student_id: user.id,
          p_org: booking.organization_id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento de aula fixa — crédito extra (${session.session_date})`,
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
          p_student_id: user.id,
          p_org: booking.organization_id,
          p_delta: 1,
          p_type: 'refunded',
          p_reason: `Cancelamento com reposição — sessão ${session.session_date}`,
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
  await offerWaitlistSpot(booking.session_id)

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
