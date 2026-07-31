// features/aulas/cancelBookings.ts
// Cancelamento em lote das reservas FUTURAS de um aluno, com estorno de crédito.
//
// Extraído de cancelFutureEnrollmentBookings (adminActions.ts) quando o bloqueio por
// pendência de check-in passou a precisar da mesma mecânica: as duas situações tiram
// o aluno das aulas que ainda não aconteceram e devolvem o crédito de quem debitou.
// A diferença é o escopo (uma turma vs. a academia toda) e se poupa a avulsa.
import type { createAdminClient } from '@/lib/supabase/server'
import { brtToday } from '@/lib/utils/gridSchedule'

type AdminClient = ReturnType<typeof createAdminClient>

export interface CancelFutureBookingsInput {
  studentId: string
  orgId: string
  /** Limita a uma turma. Ausente = todas as turmas da academia. */
  classId?: string
  /**
   * true = só as reservas nascidas da matrícula fixa: a avulsa/reposição que o aluno
   * pagou do próprio bolso continua valendo (comportamento de cancelEnrollment).
   * false = todas as confirmadas, porque o objetivo é liberar a vaga.
   */
  onlyFromEnrollment: boolean
  /**
   * Primeira data a cancelar (yyyy-MM-dd). Ausente = hoje.
   *
   * O bloqueio por pendência passa amanhã: cancelar a sessão de HOJE tiraria o aluno
   * do roster da chamada que o professor está fazendo naquele instante (o roster
   * exclui quem tem reserva `cancelled`), fazendo o aluno desaparecer da lista
   * logo depois de ser marcado como ausente.
   */
  from?: string
  /** Texto do estorno no extrato de créditos. */
  refundReason: string
}

export interface CancelFutureBookingsResult {
  cancelled: number
  /** Sessões que ficaram com vaga livre — candidatas a oferecer para a fila de espera. */
  freedSessionIds: string[]
}

/**
 * Cancela as reservas confirmadas do aluno em sessões de hoje em diante.
 *
 * A reserva fica em `cancelled` (não é apagada) de propósito: a reconciliação pula
 * qualquer sessão onde o aluno já tem reserva em QUALQUER status, então a próxima
 * geração da grade não o reserva de volta. Nenhuma lógica extra necessária.
 */
export async function cancelFutureBookings(
  client: AdminClient,
  input: CancelFutureBookingsInput,
): Promise<CancelFutureBookingsResult> {
  const { studentId, orgId, classId, onlyFromEnrollment, refundReason } = input
  const from = input.from ?? brtToday(new Date())
  const now = new Date().toISOString()

  let sessionQuery = client
    .from('class_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .gte('session_date', from)
  if (classId) sessionQuery = sessionQuery.eq('class_id', classId)

  const { data: futureSessions } = await sessionQuery
  const sessionIds = ((futureSessions ?? []) as { id: string }[]).map((s) => s.id)
  if (sessionIds.length === 0) return { cancelled: 0, freedSessionIds: [] }

  let bookingQuery = client
    .from('session_bookings')
    .select('id, session_id, credit_used')
    .eq('student_id', studentId)
    .in('session_id', sessionIds)
    .eq('status', 'confirmed')
  if (onlyFromEnrollment) bookingQuery = bookingQuery.eq('from_enrollment', true)

  const { data: bookingsRaw } = await bookingQuery
  const bookings = (bookingsRaw ?? []) as { id: string; session_id: string; credit_used: boolean }[]

  const freedSessionIds: string[] = []

  for (const b of bookings) {
    const { error: cancelErr } = await client
      .from('session_bookings')
      .update({ status: 'cancelled', cancelled_at: now })
      .eq('id', b.id)

    if (cancelErr) {
      console.error('[cancelFutureBookings] update falhou', {
        bookingId: b.id, error: cancelErr.message,
      })
      continue
    }

    freedSessionIds.push(b.session_id)

    if (!b.credit_used) continue

    // Mesma regra do cancelBooking: crédito debitado por aula que não vai acontecer
    // volta para o aluno. Falha aqui é logada, não reverte o cancelamento — que já
    // foi gravado de forma durável.
    const { error: creditErr } = await client.rpc('adjust_credits', {
      p_student_id: studentId,
      p_org: orgId,
      p_delta: 1,
      p_type: 'refunded',
      p_reason: refundReason,
      p_session_id: b.session_id,
    })
    if (creditErr) {
      console.error('[cancelFutureBookings] adjust_credits falhou', {
        bookingId: b.id, sessionId: b.session_id, error: creditErr.message,
      })
    }
  }

  return { cancelled: freedSessionIds.length, freedSessionIds }
}
