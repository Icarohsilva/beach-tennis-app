'use server'
// features/aulas/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { canCancelWithRefund, getMakeupCreditExpiry } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { offerWaitlistSpot } from './waitlistActions'
import { checkLowCreditThreshold } from './creditNotifications'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
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

  // Vínculo de parceiro (por-academia) vem da membership da academia ativa.
  const membership = await getActiveMembership()
  const useCredit = !membership?.partner

  return bookSession(sessionId, useCredit)
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
 *   4. Daily limit: ≤2 confirmed bookings on the same date
 *   5. No duplicate confirmed booking on the same session
 *   6. Capacidade e inserção atômicas via RPC book_session_atomic; débito via adjust_credits
 */
export async function bookSession(
  sessionId: string,
  useCreditArg?: boolean,
): Promise<{ error?: string }> {
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

  if ((dailyCount ?? 0) >= 2) {
    return { error: 'Você já atingiu o limite de 2 aulas por dia nessa data.' }
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

  // Decide credit usage
  const useCredit = useCreditArg ?? false
  if (useCredit && profile.credits_balance < 1) {
    return { error: 'Créditos insuficientes.' }
  }

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
// Creates a cancelled booking record so generateWeeklyBookings skips them.
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

/**
 * Marks or updates attendance for a student in a session. Admin only.
 */
export async function markAttendance(
  sessionId: string,
  studentId: string,
  present: boolean,
): Promise<{ error?: string }> {
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
      Sentry.captureException(err, { extra: { sessionId, studentId, orgId } })
    }
  }

  return {}
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
): Promise<{ error?: string }> {
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
      Sentry.captureException(err, { extra: { sessionId, studentId, orgId } })
    }
  }

  await adminClient.from('class_sessions').update({ status: 'completed' }).eq('id', sessionId)

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/admin/grade/${sessionId}`)
  return {}
}
