// features/aulas/waitlistQueries.ts
// Leitura da fila de espera para telas do admin. Sem 'use server': é chamado
// direto de Server Component, não é Server Action.
import type { createAdminClient } from '@/lib/supabase/server'
import type { WaitlistStatus } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WaitlistRow {
  id: string
  studentId: string
  fullName: string
  status: Extract<WaitlistStatus, 'waiting' | 'offered'>
  /** Ordem de chegada (1 = entrou primeiro). Com entrada automática ela vale de
   *  verdade: abrindo vaga, o 1º é promovido. */
  position: number
  joinedAt: string
  /**
   * Quando o aluno foi avisado de que virou o PRIMEIRO da fila.
   *
   * Era `notified_at` ("a fila inteira foi avisada de uma vaga"), coluna que
   * deixou de ser escrita quando a entrada virou automática — o painel mostrava
   * um campo que nunca mais ia preencher.
   */
  firstNotifiedAt: string | null
  /** WhatsApp do aluno, para o professor chamá-lo direto. null = sem telefone. */
  phone: string | null
}

/**
 * Fila ativa de uma sessão, em ordem de chegada.
 *
 * A ordem é DERIVADA de joined_at, não lida da coluna `position`: aquela coluna
 * é gravada na entrada e nunca recalculada, então fica defasada assim que
 * alguém sai da fila.
 */
export async function getSessionWaitlist(
  client: AdminClient,
  sessionId: string,
  orgId: string,
): Promise<WaitlistRow[]> {
  const { data, error } = await client
    .from('waitlists')
    .select('id, student_id, status, joined_at, first_notified_at')
    .eq('session_id', sessionId)
    .eq('organization_id', orgId)
    .in('status', ['waiting', 'offered'])
    .order('joined_at', { ascending: true })

  // A tabela pode não existir em ambientes com o schema antigo (ver migration
  // 20260807000100_waitlists_fix.sql). Fila vazia é degradação aceitável aqui —
  // a chamada não pode quebrar por causa disso.
  if (error || !data) return []

  const rows = data as {
    id: string
    student_id: string
    status: 'waiting' | 'offered'
    joined_at: string
    first_notified_at: string | null
  }[]

  const studentIds = rows.map((r) => r.student_id)
  const { data: profiles } =
    studentIds.length > 0
      ? await client.from('profiles').select('id, full_name, phone').in('id', studentIds)
      : { data: [] }

  const byId = new Map(
    ((profiles ?? []) as { id: string; full_name: string; phone: string | null }[]).map((p) => [
      p.id,
      p,
    ]),
  )

  return rows.map((r, i) => ({
    id: r.id,
    studentId: r.student_id,
    fullName: byId.get(r.student_id)?.full_name ?? 'Aluno',
    status: r.status,
    position: i + 1,
    joinedAt: r.joined_at,
    firstNotifiedAt: r.first_notified_at,
    phone: byId.get(r.student_id)?.phone ?? null,
  }))
}
