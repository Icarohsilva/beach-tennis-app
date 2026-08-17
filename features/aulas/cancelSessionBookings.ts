// features/aulas/cancelSessionBookings.ts
// A academia cancelou a aula: devolve a aula para todo mundo que estava nela.
//
// Irmão de cancelBookings.ts, que faz o recorte oposto — lá é um aluno em várias
// sessões (aluno saiu da turma, aluno bloqueado); aqui é uma sessão com todos os
// alunos (a aula daquele dia não vai acontecer).
//
// Existe porque cancelar a data só marcava `class_sessions.status` e parava aí: as
// reservas continuavam `confirmed` com `credit_used = true`. Quem pagou com
// crédito não recebia de volta, e como resolveQuota conta reserva confirmada como
// usada, a aula seguia consumindo a cota de quem é de plano. A academia cancelava
// e o aluno pagava a conta.
import type { createAdminClient } from '@/lib/supabase/server'
import { revokeLigaExtra, ENTRY_REASONS } from '@/features/liga/extraPoints'
import type { WaitlistStatus } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RefundSessionInput {
  sessionId: string
  orgId: string
  /** Texto do estorno no extrato de créditos do aluno. */
  reason: string
  /** Modalidade da turma, para a Liga revogar no ranking certo. */
  sport: string | null
}

export interface RefundSessionResult {
  /** Reservas confirmadas que foram encerradas. */
  cancelled: number
  /** Quantas delas devolveram um crédito. */
  refunded: number
  /** Alunos que tinham reserva confirmada. */
  studentIds: string[]
  /** Alunos que estavam na fila de espera e foram dispensados dela. */
  waitlistStudentIds: string[]
}

/**
 * Encerra as reservas de uma sessão devolvendo o que cada aluno gastou.
 *
 * "Devolver a aula" tem duas formas, e as duas são aplicadas:
 *
 * - **crédito**: quem debitou recebe de volta, sem vencimento. Mesma escolha de
 *   `cancelFutureBookings` — devolver um crédito já vencendo seria devolver quase
 *   nada, e o aluno não deu causa nenhuma ao cancelamento.
 * - **cota**: `admin_waived = true`. Para quem é de plano ou de parceiro não há
 *   crédito a estornar; o que precisa voltar é a CONTAGEM, para ele usar a aula em
 *   outro dia. É exatamente o que a coluna foi criada para dizer
 *   (20260807000300_booking_admin_waived.sql) e o que `resolveQuota` respeita.
 *
 * Cada reserva encerrada aqui fica marcada com `cancelled_by_session = true`, e é
 * essa marca que `restoreSessionBookings` reverte quando a aula volta. Sem ela a
 * reabertura não teria como distinguir estas reservas das que o professor
 * cancelou uma a uma.
 *
 * Falha de estorno é logada e NÃO reverte o cancelamento, que já está gravado de
 * forma durável — mesmo contrato de `cancelFutureBookings`.
 */
export async function refundSessionBookings(
  client: AdminClient,
  input: RefundSessionInput,
): Promise<RefundSessionResult> {
  const { sessionId, orgId, reason, sport } = input
  const now = new Date().toISOString()

  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('id, student_id, credit_used')
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .eq('status', 'confirmed')

  const bookings = (bookingsRaw ?? []) as {
    id: string
    student_id: string
    credit_used: boolean
  }[]

  const studentIds: string[] = []
  let refunded = 0

  for (const b of bookings) {
    const { error: cancelErr } = await client
      .from('session_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: now,
        // Isenta da cota do ciclo. Sem isto, a aula que a ACADEMIA cancelou
        // continuaria contando contra o plano do aluno.
        admin_waived: true,
        // Assina QUEM derrubou esta reserva. É o que a reabertura da aula usa
        // para saber quem trazer de volta: `admin_waived` sozinho também marca
        // o aluno que o professor tirou da data, e esse não pode voltar.
        cancelled_by_session: true,
      })
      .eq('id', b.id)

    if (cancelErr) {
      console.error('[refundSessionBookings] update falhou', {
        bookingId: b.id, sessionId, error: cancelErr.message,
      })
      continue
    }

    studentIds.push(b.student_id)

    if (b.credit_used) {
      const { error: creditErr } = await client.rpc('adjust_credits', {
        p_student_id: b.student_id,
        p_org: orgId,
        p_delta: 1,
        p_type: 'refunded',
        p_reason: reason,
        p_session_id: sessionId,
      })
      if (creditErr) {
        console.error('[refundSessionBookings] adjust_credits falhou', {
          bookingId: b.id, sessionId, studentId: b.student_id, error: creditErr.message,
        })
      } else {
        refunded++
      }
    }

    // Liga: a aula não vai acontecer, então o ponto de ter entrado nela (com
    // antecedência ou pegando vaga na fila) deixa de valer. Best-effort, como
    // todo o resto da Liga — nunca derruba o cancelamento.
    for (const ligaReason of ENTRY_REASONS) {
      await revokeLigaExtra(client, {
        orgId,
        studentId: b.student_id,
        reason: ligaReason,
        sourceId: sessionId,
        sport,
      })
    }
  }

  // Fila de espera: esperar vaga numa aula que não vai existir é ruído. As
  // entradas ativas são encerradas e essas pessoas também precisam ser avisadas.
  const { data: waitingRaw } = await client
    .from('waitlists')
    .update({ status: 'cancelled' as WaitlistStatus })
    .eq('session_id', sessionId)
    .in('status', ['waiting', 'offered'])
    .select('student_id')

  const waitlistStudentIds = ((waitingRaw ?? []) as { student_id: string }[]).map(
    (w) => w.student_id,
  )

  return { cancelled: studentIds.length, refunded, studentIds, waitlistStudentIds }
}
