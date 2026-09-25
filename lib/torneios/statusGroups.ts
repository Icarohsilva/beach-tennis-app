// lib/torneios/statusGroups.ts
// A lista de torneios do admin dividida por status. Puro, sem I/O.
//
// Numa lista única por data, o torneio que está rolando agora ficava no meio
// dos encerrados do mês passado. A ordem dos grupos é a ordem de urgência: o
// que está acontecendo, o que está recebendo inscrição, o que falta publicar
// e, SEMPRE por último, o que já acabou — que só cresce e não pede ação.
import type { TournamentStatus } from '@/types'

export interface StatusGroup<T> {
  status: TournamentStatus
  label: string
  items: T[]
}

export const STATUS_GROUP_ORDER: readonly TournamentStatus[] = [
  'in_progress',
  'open',
  'draft',
  'finished',
]

const GROUP_LABEL: Record<TournamentStatus, string> = {
  in_progress: 'Em andamento',
  open: 'Inscrições abertas',
  draft: 'Rascunhos',
  finished: 'Encerrados',
}

/**
 * Agrupa e ordena. Nos grupos ativos o mais PRÓXIMO vem primeiro (é o próximo
 * a exigir trabalho); nos encerrados, o mais RECENTE, que é o que ainda tem
 * pódio para divulgar. Grupo vazio não aparece.
 */
export function groupTournamentsByStatus<T extends { status: TournamentStatus; date: string }>(
  items: T[],
): StatusGroup<T>[] {
  return STATUS_GROUP_ORDER.map((status) => {
    const inGroup = items.filter((t) => t.status === status)
    inGroup.sort((a, b) =>
      status === 'finished' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
    )
    return { status, label: GROUP_LABEL[status], items: inGroup }
  }).filter((g) => g.items.length > 0)
}
