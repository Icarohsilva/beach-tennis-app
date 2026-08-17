// features/aulas/reopenSessionBookings.ts
// A aula voltou: desfaz o que o cancelamento dela tirou dos alunos.
//
// Inverso de `refundSessionBookings`. Só existe porque desfazer não é simétrico a
// fazer: o cancelamento devolveu crédito para a mão do aluno, e re-debitar isso
// numa reabertura poderia falhar (ele pode ter gasto no meio tempo) ou passar por
// cima de uma escolha dele. Então a reabertura tem dois públicos, e trata cada um
// de um jeito:
//
//   - reserva SEM crédito (aluno de plano/parceiro, reserva vinda da matrícula
//     fixa): volta sozinha. Não custa nada a ninguém — a reserva era isenta.
//   - reserva COM crédito (avulsa paga): fica como está. O crédito já voltou, e
//     quem quiser a vaga entra de novo. Quem chama daqui avisa essa gente.
import type { createAdminClient } from '@/lib/supabase/server'
import { chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RestoreSessionBookingsInput {
  /** Sessões que acabaram de voltar para `scheduled`. */
  sessionIds: string[]
  orgId: string
}

export interface RestoreSessionBookingsResult {
  /** Alunos cuja reserva foi liberada para a reconciliação re-criar. */
  restoredStudentIds: string[]
  /**
   * Alunos que tinham pago com crédito. NÃO voltam: precisam ser convidados a
   * entrar de novo, e é isso que o aviso de reabertura diz para eles.
   */
  creditStudentIds: string[]
}

/**
 * Apaga as reservas que o cancelamento da aula derrubou, para que a
 * reconciliação as recrie.
 *
 * **Apaga em vez de virar `confirmed`** por dois motivos. O primeiro é
 * precedente: `adminUnskipEnrollmentDate` já desfaz uma reserva cancelada
 * apagando a linha. O segundo é o que importa — deixar
 * `reconcileAllActiveEnrollments` recriar mantém UM escritor das reservas fixas,
 * e ele é quem revalida capacidade, férias aprovadas, cota do ciclo e pendência
 * de check-in. Marcar `confirmed` na mão pularia os quatro e poderia, por
 * exemplo, colocar de volta numa aula um aluno que entrou de férias depois do
 * cancelamento.
 *
 * O filtro é `cancelled_by_session`, e não `admin_waived`: aquela coluna também
 * marca o aluno que o professor tirou daquela data de propósito, e ressuscitá-lo
 * seria desfazer uma decisão da academia (ver a migração
 * 20260818000000_booking_cancelled_by_session.sql).
 *
 * Best-effort como o resto da cadeia de cancelamento: falha é logada e não
 * derruba a reabertura, que já está gravada.
 */
export async function restoreSessionBookings(
  client: AdminClient,
  input: RestoreSessionBookingsInput,
): Promise<RestoreSessionBookingsResult> {
  const { sessionIds, orgId } = input
  if (sessionIds.length === 0) return { restoredStudentIds: [], creditStudentIds: [] }

  const restoredStudentIds: string[] = []
  const creditStudentIds: string[] = []

  for (const ids of chunk(sessionIds, IN_CHUNK_SIZE)) {
    const { data: rowsRaw, error: readErr } = await client
      .from('session_bookings')
      .select('id, student_id, credit_used')
      .in('session_id', ids)
      .eq('organization_id', orgId)
      .eq('status', 'cancelled')
      .eq('cancelled_by_session', true)

    if (readErr) {
      console.error('[restoreSessionBookings] leitura falhou', {
        orgId, sessions: ids.length, error: readErr.message,
      })
      continue
    }

    const rows = (rowsRaw ?? []) as { id: string; student_id: string; credit_used: boolean }[]

    const semCredito = rows.filter((r) => !r.credit_used)
    for (const r of rows) {
      if (r.credit_used) creditStudentIds.push(r.student_id)
    }

    if (semCredito.length === 0) continue

    const { error: delErr } = await client
      .from('session_bookings')
      .delete()
      .in(
        'id',
        semCredito.map((r) => r.id),
      )

    if (delErr) {
      console.error('[restoreSessionBookings] delete falhou', {
        orgId, bookings: semCredito.length, error: delErr.message,
      })
      continue
    }

    for (const r of semCredito) restoredStudentIds.push(r.student_id)
  }

  return {
    restoredStudentIds: Array.from(new Set(restoredStudentIds)),
    creditStudentIds: Array.from(new Set(creditStudentIds)),
  }
}
