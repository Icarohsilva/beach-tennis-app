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
  /** Posição na fila (1 = próximo), derivada de joined_at. */
  position: number
  joinedAt: string
  notifiedAt: string | null
  /** Prazo final para aceitar (só quando status = 'offered'). */
  offerDeadline: string | null
}

/**
 * Fila ativa de uma sessão, em ordem de chegada.
 *
 * A posição é DERIVADA de joined_at, não lida da coluna `position`: aquela
 * coluna é gravada na entrada e nunca recalculada, então fica defasada assim
 * que alguém sai da fila. offerWaitlistSpot também ordena por joined_at — usar
 * a mesma fonte aqui garante que a tela do professor mostre exatamente a ordem
 * em que as vagas serão oferecidas.
 */
export async function getSessionWaitlist(
  client: AdminClient,
  sessionId: string,
  orgId: string,
): Promise<WaitlistRow[]> {
  const { data, error } = await client
    .from('waitlists')
    .select('id, student_id, status, joined_at, notified_at')
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
    notified_at: string | null
  }[]

  const studentIds = rows.map((r) => r.student_id)
  const { data: profiles } =
    studentIds.length > 0
      ? await client.from('profiles').select('id, full_name').in('id', studentIds)
      : { data: [] }

  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  return rows.map((r, i) => ({
    id: r.id,
    studentId: r.student_id,
    fullName: nameById.get(r.student_id) ?? 'Aluno',
    status: r.status,
    position: i + 1,
    joinedAt: r.joined_at,
    notifiedAt: r.notified_at,
    offerDeadline:
      r.status === 'offered' && r.notified_at
        ? new Date(new Date(r.notified_at).getTime() + 60 * 60 * 1000).toISOString()
        : null,
  }))
}
