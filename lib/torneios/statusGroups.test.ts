import { describe, it, expect } from 'vitest'
import { groupTournamentsByStatus } from './statusGroups'
import type { TournamentStatus } from '@/types'

const t = (id: string, status: TournamentStatus, date: string) => ({ id, status, date })

describe('groupTournamentsByStatus', () => {
  const list = [
    t('fin-antigo', 'finished', '2026-06-01'),
    t('aberto-longe', 'open', '2026-12-10'),
    t('rascunho', 'draft', '2026-11-20'),
    t('fin-recente', 'finished', '2026-09-01'),
    t('rolando', 'in_progress', '2026-09-25'),
    t('aberto-perto', 'open', '2026-11-01'),
  ]

  it('põe em andamento primeiro e encerrados sempre por último', () => {
    expect(groupTournamentsByStatus(list).map((g) => g.status)).toEqual([
      'in_progress',
      'open',
      'draft',
      'finished',
    ])
  })

  it('ativos do mais próximo ao mais distante; encerrados do mais recente', () => {
    const groups = groupTournamentsByStatus(list)
    expect(groups.find((g) => g.status === 'open')!.items.map((i) => i.id)).toEqual([
      'aberto-perto',
      'aberto-longe',
    ])
    expect(groups.find((g) => g.status === 'finished')!.items.map((i) => i.id)).toEqual([
      'fin-recente',
      'fin-antigo',
    ])
  })

  it('omite grupo vazio e não altera a lista de entrada', () => {
    const only = [t('a', 'open', '2026-11-01')]
    expect(groupTournamentsByStatus(only).map((g) => g.label)).toEqual(['Inscrições abertas'])
    expect(groupTournamentsByStatus([])).toEqual([])
    expect(list[0].id).toBe('fin-antigo')
  })
})
