'use server'
// features/aulas/actions.ts

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import { canCancelWithRefund, getMakeupCreditExpiry } from '@/lib/utils/creditRules'
import type { StudentLevel, ClassType, BookingStatus, SessionStatus } from '@/types'

// ---------------------------------------------------------------------------
// bookSession
// ---------------------------------------------------------------------------

/**
 * Books a class session for the current authenticated student.
 *
 * Validations (in order):
 *   1. Student exists
 *   2. Session exists and is scheduled
 *   3. Level check via canStudentAttendLevel
 *   4. Kids check: turma kids → student must be a dependent
 *   5. Daily limit: ≤2 confirmed bookings on the same date
 *   6. No duplicate confirmed booking on the same session
 *   7. Debit credit if credit_used=true and insert credit_transaction
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

  // 1. Fetch student profile
  const { data: profile, error: profileErr } = await adminClient
    .from('profiles')
    .select('id, level, is_dependent, credits_balance')
    .eq('id', user.id)
    .single()
  if (profileErr || !profile) return { error: 'Perfil não encontrado.' }

  // 2. Fetch session + class
  const { data: session, error: sessionErr } = await adminClient
    .from('class_sessions')
    .select('id, class_id, session_date, status, class:classes(id, level, type, max_students, name)')
    .eq('id', sessionId)
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

  // 3. Level check
  if (!canStudentAttendLevel(profile.level as StudentLevel, cls.level)) {
    return { error: `Seu nível (${profile.level}) não permite participar desta turma (${cls.level}).` }
  }

  // 4. Kids check
  if (cls.type === 'kids' && !profile.is_dependent) {
    return { error: 'Esta turma é exclusiva para alunos kids (dependentes).' }
  }

  // 5. Daily limit
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
          .eq('session_date', session.session_date)
      ).data?.map((s: { id: string }) => s.id) ?? [],
    )

  if ((dailyCount ?? 0) >= 2) {
    return { error: 'Você já atingiu o limite de 2 aulas por dia nessa data.' }
  }

  // 6. Duplicate check
  const { count: dupCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', user.id)
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((dupCount ?? 0) > 0) {
    return { error: 'Você já possui um agendamento confirmado nesta sessão.' }
  }

  // 7. Capacity check
  const { count: bookedCount } = await adminClient
    .from('session_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('status', 'confirmed')

  if ((bookedCount ?? 0) >= cls.max_students) {
    return { error: 'Esta turma está lotada.' }
  }

  // Decide credit usage
  const useCredit = useCreditArg ?? false
  if (useCredit && profile.credits_balance < 1) {
    return { error: 'Créditos insuficientes.' }
  }

  // Insert booking
  const { data: newBooking, error: insertErr } = await adminClient
    .from('session_bookings')
    .insert({
      student_id: user.id,
      session_id: sessionId,
      type: 'extra',
      status: 'confirmed' as BookingStatus,
      from_enrollment: false,
      credit_used: useCredit,
    })
    .select('id')
    .single()

  if (insertErr || !newBooking) {
    return { error: 'Erro ao criar agendamento. Tente novamente.' }
  }

  // Credit debit
  if (useCredit) {
    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'used',
      amount: -1,
      reason: `Agendamento avulso — ${cls.name} (${session.session_date})`,
      session_id: sessionId,
      expires_at: null,
    })

    await adminClient
      .from('profiles')
      .update({ credits_balance: profile.credits_balance - 1 })
      .eq('id', user.id)
  }

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
    .select('id, student_id, session_id, status, credit_used')
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
  const sessionStartIso = `${session.session_date}T${cls.start_time}`

  const now = new Date().toISOString()
  const refundEligible = canCancelWithRefund(sessionStartIso, now)

  // Cancel booking
  const { error: cancelErr } = await adminClient
    .from('session_bookings')
    .update({
      status: 'cancelled' as BookingStatus,
      cancelled_at: now,
    })
    .eq('id', bookingId)

  if (cancelErr) return { error: 'Erro ao cancelar. Tente novamente.' }

  // Refund credit if applicable
  if (refundEligible && booking.credit_used) {
    // Fetch credit_expiry_days from system_settings (default 30)
    let expiryDays = 30
    const { data: settings } = await adminClient
      .from('system_settings')
      .select('credit_expiry_days')
      .single()
    if (settings?.credit_expiry_days) expiryDays = settings.credit_expiry_days

    const expiry = getMakeupCreditExpiry(new Date(), expiryDays)

    await adminClient.from('credit_transactions').insert({
      student_id: user.id,
      type: 'refunded',
      amount: 1,
      reason: `Cancelamento com reposição — sessão ${session.session_date}`,
      session_id: booking.session_id,
      expires_at: expiry.toISOString(),
    })

    // Update cached balance
    const { data: profile } = await adminClient
      .from('profiles')
      .select('credits_balance')
      .eq('id', user.id)
      .single()

    if (profile) {
      await adminClient
        .from('profiles')
        .update({ credits_balance: profile.credits_balance + 1 })
        .eq('id', user.id)
    }
  }

  return {}
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

  // Verify caller is admin
  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (callerProfile?.role !== 'admin') return { error: 'Sem permissão.' }

  // Upsert attendance
  const { error: upsertErr } = await adminClient.from('attendance').upsert(
    {
      student_id: studentId,
      session_id: sessionId,
      status: present ? 'present' : 'absent',
      source: 'manual',
      checked_in_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,session_id' },
  )

  if (upsertErr) return { error: 'Erro ao registrar presença.' }
  return {}
}
