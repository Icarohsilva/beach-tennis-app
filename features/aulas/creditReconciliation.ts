// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import { buildReconciliationOps, requiresCredit } from '@/lib/utils/reconciliationOps'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'

export interface ReconcileResult {
  booked: number
  granted: number
  debited: number
  skipped: number
}

const EMPTY: ReconcileResult = { booked: 0, granted: 0, debited: 0, skipped: 0 }

/**
 * Reconcilia os créditos de UMA matrícula (aluno+turma) no intervalo [from, to]:
 * para cada sessão scheduled ainda não reservada, reserva a sessão, concede 1
 * crédito e debita 1 crédito (Wellhub/TotalPass: só reserva). Idempotente.
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

  // Turma (capacidade + academia)
  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students, organization_id')
    .eq('id', classId)
    .single()
  if (!cls) return result

  // payment_type é por-academia: vem da membership do aluno nesta academia.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('payment_type')
    .eq('user_id', studentId)
    .eq('organization_id', cls.organization_id)
    .single()
  if (!membership) return result

  const paymentType = membership.payment_type as string
  const needsCredit = requiresCredit(paymentType)

  // Nome do plano para o log (só relevante quando há crédito)
  let planName = 'Mensal'
  if (needsCredit) {
    const { data: sub } = await adminClient
      .from('student_subscriptions')
      .select('subscription_plans(name)')
      .eq('student_id', studentId)
      .eq('organization_id', cls.organization_id)
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

  // Sessões em que o aluno já tem reserva (QUALQUER status). Inclui canceladas
  // de propósito: opt-out de aula fixa (skipEnrollmentNoBooking) e saída com
  // refund (skipEnrollmentSession) deixam uma reserva 'cancelled'. Reconciliar
  // não pode reativá-las nem reconceder crédito — pulamos qualquer linha
  // existente (o unique student_id+session_id garante no máximo uma).
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
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

    // 2. Concede 1 crédito (log). Só debita se a concessão funcionou — assim um
    //    erro na concessão não faz o débito consumir saldo pré-existente.
    //    Obs.: as 3 RPCs não são atômicas entre si; uma falha após a reserva
    //    pode deixar a sessão reservada sem o par concede/debita. É raro
    //    (cada RPC é atômica) e fica registrado no log para auditoria.
    const { error: grantErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: cls.organization_id,
      p_delta: 1,
      p_type: 'renewed',
      p_reason: op.grantReason,
    })
    if (grantErr) {
      console.error('[reconcileEnrollmentCredits] concessao falhou', {
        studentId, sessionId: op.sessionId, error: grantErr.message,
      })
      continue
    }
    result.granted++

    // 3. Debita 1 crédito (log, vinculado à sessão)
    const { error: debitErr } = await adminClient.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: cls.organization_id,
      p_delta: -1,
      p_type: 'used',
      p_reason: op.debitReason,
      p_session_id: op.sessionId,
    })
    if (debitErr) {
      console.error('[reconcileEnrollmentCredits] debito falhou', {
        studentId, sessionId: op.sessionId, error: debitErr.message,
      })
      continue
    }
    result.debited++
  }

  return result
}

/**
 * Reconcilia matrículas ativas no intervalo [from, to].
 * Inclui apenas alunos com assinatura ativa OU Wellhub/TotalPass.
 *
 * Auditoria #2:
 *  - `orgId` opcional escopa a execução a UMA academia. Isto habilita o
 *    padrão fan-out (um job por arena) para não estourar o timeout serverless
 *    quando houver muitas academias/matrículas.
 *  - Cada matrícula roda dentro de try/catch: uma falha isolada não aborta o
 *    lote inteiro (antes, um erro derrubava toda a renovação mensal).
 */
export async function reconcileAllActiveEnrollments(
  from: string,
  to: string,
  orgId?: string,
): Promise<ReconcileResult & { processedEnrollments: number; failed: number }> {
  const adminClient = createAdminClient()

  let enrollQuery = adminClient
    .from('enrollments')
    .select('student_id, class_id, organization_id')
    .eq('is_active', true)
  if (orgId) enrollQuery = enrollQuery.eq('organization_id', orgId)
  const { data: enrollmentsRaw } = await enrollQuery

  type Row = {
    student_id: string
    class_id: string
    organization_id: string
  }
  const enrollments = (enrollmentsRaw ?? []) as unknown as Row[]

  // payment_type é por-academia: indexado por user_id+organization_id.
  let membershipsQuery = adminClient
    .from('memberships')
    .select('user_id, organization_id, payment_type')
  if (orgId) membershipsQuery = membershipsQuery.eq('organization_id', orgId)
  const { data: membershipsRaw } = await membershipsQuery
  const paymentTypeByMember = new Map<string, string>(
    (membershipsRaw ?? []).map(
      (m: { user_id: string; organization_id: string; payment_type: string }) =>
        [`${m.user_id}:${m.organization_id}`, m.payment_type],
    ),
  )

  // Alunos com assinatura ativa E em dia (por-academia). Assinatura MP com
  // período vencido NÃO renova créditos (spec §3.3) — volta a renovar quando
  // o webhook confirmar a cobrança do período.
  let subsQuery = adminClient
    .from('student_subscriptions')
    .select('student_id, organization_id, gateway, current_period_end')
    .eq('status', 'active')
  if (orgId) subsQuery = subsQuery.eq('organization_id', orgId)
  const { data: subsRaw } = await subsQuery
  const now = new Date()
  const activeSubStudents = new Set(
    ((subsRaw ?? []) as {
      student_id: string
      organization_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => `${s.student_id}:${s.organization_id}`),
  )

  const totals = { ...EMPTY, processedEnrollments: 0, failed: 0 }

  for (const e of enrollments) {
    const memberKey = `${e.student_id}:${e.organization_id}`
    const paymentType = paymentTypeByMember.get(memberKey) ?? 'subscriber'
    const eligible = !requiresCredit(paymentType) || activeSubStudents.has(memberKey)
    if (!eligible) continue

    try {
      const r = await reconcileEnrollmentCredits(e.student_id, e.class_id, from, to, adminClient)
      totals.booked += r.booked
      totals.granted += r.granted
      totals.debited += r.debited
      totals.skipped += r.skipped
      totals.processedEnrollments++
    } catch (err) {
      totals.failed++
      console.error('[reconcileAllActiveEnrollments] matrícula falhou', {
        studentId: e.student_id, classId: e.class_id, organizationId: e.organization_id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return totals
}

/**
 * Lista os ids das academias com pelo menos uma matrícula ativa. Usado pelo
 * dispatcher do cron para processar uma academia por vez (auditoria #2).
 */
export async function listOrgIdsWithActiveEnrollments(): Promise<string[]> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('enrollments')
    .select('organization_id')
    .eq('is_active', true)
  const ids = new Set<string>((data ?? []).map((r: { organization_id: string }) => r.organization_id))
  return Array.from(ids)
}

/** Janela "restante do mês" reexportada para conveniência dos callers. */
export { getRemainingMonthWindow }
