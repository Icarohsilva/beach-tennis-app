import { describe, it, expect } from 'vitest'
import { groupPageSlots, vacancyLabel } from './pageView'

const s = (id: string, date: string, start: string, end: string, capacity = 10, occupied = 0) => ({
  id, date, start_time: start, end_time: end, capacity, occupied,
})

describe('groupPageSlots', () => {
  // 04/10/2026 10:00 em Brasília = 13:00 UTC.
  const now = new Date('2026-10-04T13:00:00Z')

  it('agrupa por dia na ordem do calendário e tira o que já terminou', () => {
    const groups = groupPageSlots(
      [
        s('dom-tarde', '2026-10-04', '14:00', '17:00'),
        s('sab-seguinte', '2026-10-10', '09:00', '12:00'),
        s('dom-manha-acabou', '2026-10-04', '07:00', '09:00'),
        s('dom-rolando', '2026-10-04', '09:00', '12:00'),
      ],
      now,
    )
    expect(groups.map((g) => g.date)).toEqual(['2026-10-04', '2026-10-10'])
    expect(groups[0].items.map((i) => i.slot.id)).toEqual(['dom-rolando', 'dom-tarde'])
  })

  it('diz quantas vagas sobram e marca lotado', () => {
    const [g] = groupPageSlots([s('a', '2026-10-10', '09:00', '12:00', 8, 8), s('b', '2026-10-10', '14:00', '17:00', 8, 7)], now)
    expect(g.items[0]).toMatchObject({ full: true, left: 0, vacancyLabel: 'Lotado' })
    expect(g.items[1]).toMatchObject({ full: false, left: 1, vacancyLabel: 'Última vaga' })
  })

  it('sem datas futuras, lista vazia', () => {
    expect(groupPageSlots([s('x', '2026-10-01', '09:00', '12:00')], now)).toEqual([])
  })
})

describe('vacancyLabel', () => {
  it('fala no singular e no plural', () => {
    expect(vacancyLabel(5)).toBe('5 vagas')
    expect(vacancyLabel(1)).toBe('Última vaga')
    expect(vacancyLabel(0)).toBe('Lotado')
  })
})
