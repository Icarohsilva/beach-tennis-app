// features/aulas/reconcileEnrollment.ts
// Reconcilia UMA matrícula (aluno+turma): reserva as sessões da janela que
// ainda não foram reservadas. Extraído de creditReconciliation.ts pra ficar
// mockável isoladamente nos testes de reconcileAllActiveEnrollments.
import { createAdminClient } from '@/lib/supabase/server'
import { buildReconciliationOps } from '@/lib/utils/reconciliationOps'

export interface ReconcileResult {
  booked: number
  skipped: number
  /** Pendente reservar, mas sem orçamento de cota — não é falha, é limite. */
  quotaSkipped: number
}

const EMPTY: ReconcileResult = { booked: 0, skipped: 0, quotaSkipped: 0 }

/**
 * Reserva as sessões da matrícula fixa (aluno+turma) no intervalo [from, to].
 * Idempotente.
 *
 * NÃO mexe em crédito: desde 2026-07 matrícula fixa exige plano ou parceiro, e
 * os dois entram de graça (spec §3). Antes daqui saía um par concede/debita por
 * sessão — era a mecânica de "plano dá crédito", que deixou de existir.
 *
 * `quotaBudget`: quantas sessões ainda podem ser reservadas nesta chamada por
 * causa da cota do aluno. `null` = sem limite (parceiro, cota desligada, ou
 * aluno sem plano ativo — ver reconcileAllActiveEnrollments). Sessões
 * pendentes além do orçamento contam em `quotaSkipped`, não em `skipped`
 * (que é reservado pra falha real de reserva — lotação ou corrida).
 */
export async function reconcileEnrollmentCredits(
  studentId: string,
  classId: string,
  from: string,
  to: string,
  injectedClient?: ReturnType<typeof createAdminClient>,
  quotaBudget: number | null = null,
  /**
   * Datas em que o aluno está de férias. Sessão nessas datas é pulada: ele
   * avisou que não vem, e reservá-lo prenderia uma vaga que a fila poderia usar.
   * Conjunto pronto (`vacationDatesInWindow`) em vez de reavaliar os períodos
   * por sessão.
   */
  vacationDates: Set<string> = new Set(),
): Promise<ReconcileResult> {
  const adminClient = injectedClient ?? createAdminClient()
  const result: ReconcileResult = { ...EMPTY }

  const { data: cls } = await adminClient
    .from('classes')
    .select('max_students, organization_id')
    .eq('id', classId)
    .single()
  if (!cls) return result

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

  // Reservas existentes em QUALQUER status. As canceladas entram de propósito:
  // opt-out de aula fixa (skipEnrollmentNoBooking) e saída com refund
  // (skipEnrollmentSession) deixam uma reserva 'cancelled', e reconciliar não
  // pode reativá-las. O unique student_id+session_id garante no máximo uma.
  const sessionIds = sessions.map((s) => s.id)
  const { data: existingRaw } = await adminClient
    .from('session_bookings')
    .select('session_id')
    .eq('student_id', studentId)
    .in('session_id', sessionIds)
  const bookedSessionIds = new Set(
    (existingRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const ops = buildReconciliationOps(sessions, bookedSessionIds)

  for (const op of ops) {
    // Férias vem antes da cota: não é limite atingido, é aluno ausente. Contar
    // como quotaSkipped mandaria o sinal errado para o relatório da geração.
    if (vacationDates.has(op.sessionDate)) continue
    if (quotaBudget !== null && result.booked >= quotaBudget) {
      result.quotaSkipped++
      continue
    }
    const { error: bookErr } = await adminClient.rpc('book_session_atomic', {
      p_student_id: studentId,
      p_session_id: op.sessionId,
      p_max_students: cls.max_students,
      p_type: 'extra',
      p_from_enrollment: true,
      p_credit_used: false,
    })
    if (bookErr) {
      // SESSION_FULL ou ALREADY_BOOKED (corrida): pula.
      result.skipped++
      continue
    }
    result.booked++
  }

  return result
}
