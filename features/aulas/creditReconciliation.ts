// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import { buildReconciliationOps, requiresCredit } from '@/lib/utils/reconciliationOps'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'

export interface ReconcileResult {
  booked: number
  granted: number
  debited: number
  skipped: number
}

const EMPTY: ReconcileResult = { booked: 0, granted: 0, debited: 0, skipped: 0 }

/**
 * Reconcilia os créditos de UMA matrícula (aluno+turma) no intervalo [from, to]:
 * para cada sessão scheduled ainda não reservada, concede 1 crédito, reserva a
 * sessão e debita 1 crédito (Wellhub/TotalPass: só reserva). Idempotente.
 */
export async function reconcileEnrollmentCredits(
  studentId: string,
  classId: string,
  from: string,
  to: string,
  injectedClient?: ReturnType<typeof createAdminClient>,
): Promise<ReconcileResult> {
  const adminClient = injectedClient ?? createAdminClient()
  const result: ReconcileResult = { ...EMPTY }

  // Perfil (payment_type) e turma (capacidade)
  const { data: profile } = await adminClient
    .from('profiles')
    .select('payment_type')
    .eq('id', studentId)
    .single()
  if (!profile) return result

  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students')
    .eq('id', classId)
    .single()
  if (!cls) return result

  const paymentType = profile.payment_type as string
  const needsCredit = requiresCredit(paymentType)

  // Nome do plano para o log (só relevante quando há crédito)
  let planName = 'Mensal'
  if (needsCredit) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('subscription_plans(name)')
      .eq('student_id', studentId)
      .eq('status', 'active')
      .maybeSingle()
    const planRel = (sub as { subscription_plans: { name: string } | { name: string }[] } | null)
      ?.subscription_plans
    const planObj = Array.isArray(planRel) ? planRel[0] : planRel
    if (planObj?.name) planName = planObj.name
  }

  // Sessões agendadas no intervalo
  const { data: sessionsRaw } = await adminClient
    .from('class_sessions')
    .select('id, session_date')
    .eq('class_id', classId)
    .eq('status', 'scheduled')
    .gte('session_date', from)
    .lte('session_date', to)
    .order('session_date', { ascending: true })

  const sessions = (sessionsRaw ?? []) as { id: string; session_date: string }[]
  if (sessions.length === 0) return result

  // Reservas confirmadas existentes do aluno entre essas sessões
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .eq('status', 'confirmed')
    .in('session_id', sessionIds)
  const bookedSessionIds = new Set(
    (existingRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const ops = buildReconciliationOps(sessions, bookedSessionIds, paymentType, planName)

  for (const op of ops) {
    // 1. Reserva (atômica: respeita capacidade e reativa cancelado)
    const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
      p_student_id: studentId,
      p_session_id: op.sessionId,
      p_max_students: cls.max_students,
      p_type: 'extra',
      p_from_enrollment: true,
      p_credit_used: op.needsCredit,
    })
    if (bookErr) {
      // SESSION_FULL ou ALREADY_BOOKED (corrida): pula sem mexer em crédito
      result.skipped++
      continue
    }
    result.booked++

    if (!op.needsCredit) continue

    // 2. Concede 1 crédito (log)
    const { error: grantErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_delta: 1,
      p_type: 'renewed',
      p_reason: op.grantReason,
    })
    if (!grantErr) result.granted++

    // 3. Debita 1 crédito (log, vinculado à sessão)
    const { error: debitErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_delta: -1,
      p_type: 'used',
      p_reason: op.debitReason,
      p_session_id: op.sessionId,
    })
    if (!debitErr) result.debited++
  }

  return result
}

/**
 * Reconcilia TODAS as matrículas ativas no intervalo [from, to].
 * Inclui apenas alunos com assinatura ativa OU Wellhub/TotalPass.
 */
export async function reconcileAllActiveEnrollments(
  from: string,
  to: string,
): Promise<ReconcileResult & { processedEnrollments: number }> {
  const adminClient = createAdminClient()

  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('student_id, class_id, profiles(payment_type)')
    .eq('is_active', true)

  type Row = {
    student_id: string
    class_id: string
    profiles: { payment_type: string } | { payment_type: string }[] | null
  }
  const enrollments = (enrollmentsRaw ?? []) as unknown as Row[]

  // Alunos com assinatura ativa
  const { data: subsRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id')
    .eq('status', 'active')
  const activeSubStudents = new Set(
    (subsRaw ?? []).map((s: { student_id: string }) => s.student_id),
  )

  const totals = { ...EMPTY, processedEnrollments: 0 }

  for (const e of enrollments) {
    const prof = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    const paymentType = prof?.payment_type ?? 'subscriber'
    const eligible = !requiresCredit(paymentType) || activeSubStudents.has(e.student_id)
    if (!eligible) continue

    const r = await reconcileEnrollmentCredits(e.student_id, e.class_id, from, to, adminClient)
    totals.booked += r.booked
    totals.granted += r.granted
    totals.debited += r.debited
    totals.skipped += r.skipped
    totals.processedEnrollments++
  }

  return totals
}

/** Janela "restante do mês" reexportada para conveniência dos callers. */
export { getRemainingMonthWindow }
