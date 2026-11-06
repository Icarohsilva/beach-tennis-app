import { describe, it, expect } from 'vitest'
import { buildTrialSchedule, hasOpenSlot, type TrialSessionRow } from './trialSchedule'

const CLS: NonNullable<TrialSessionRow['class']> = {
  name: 'Iniciante',
  level: 'iniciante',
  type: 'adult',
  start_time: '19:00',
  end_time: '20:00',
  max_students: 4,
  court: 1,
  is_active: true,
  gender_restriction: null,
}

function row(id: string, date: string, over: Partial<TrialSessionRow> = {}, cls: Partial<typeof CLS> = {}): TrialSessionRow {
  return { id, session_date: date, status: 'scheduled', class: { ...CLS, ...cls }, ...over }
}

// 10/11/2026 12:00 em Brasília.
const NOW = new Date('2026-11-10T12:00:00-03:00')

describe('buildTrialSchedule', () => {
  it('agrupa por dia e ordena pelo horário daquela data, não pelo da turma', () => {
    const days = buildTrialSchedule(
      [
        row('b', '2026-11-11', {}, { start_time: '18:00', end_time: '19:00' }),
        row('a', '2026-11-11', { start_time: '07:00', end_time: '08:00' }),
        row('c', '2026-11-10', {}, { start_time: '20:00', end_time: '21:00' }),
      ],
      new Map(),
      NOW,
    )
    expect(days.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11'])
    expect(days[1].slots.map((s) => s.id)).toEqual(['a', 'b'])
    expect(days[1].slots[0].startTime).toBe('07:00')
  })

  it('aula lotada continua na grade, marcada como lotada', () => {
    const days = buildTrialSchedule([row('cheia', '2026-11-11')], new Map([['cheia', 4]]), NOW)
    expect(days[0].slots[0]).toMatchObject({ full: true, spotsLeft: 0 })
    expect(hasOpenSlot(days)).toBe(false)
  })

  it('vagas usam a capacidade da data quando ela foi alterada', () => {
    const days = buildTrialSchedule([row('x', '2026-11-11', { max_students: 6 })], new Map([['x', 4]]), NOW)
    expect(days[0].slots[0]).toMatchObject({ spotsLeft: 2, full: false })
    expect(hasOpenSlot(days)).toBe(true)
  })

  it('fica de fora o que não dá para marcar: já começou, kids, turma inativa, cancelada', () => {
    const days = buildTrialSchedule(
      [
        row('manha', '2026-11-10', {}, { start_time: '08:00', end_time: '09:00' }),
        row('kids', '2026-11-11', {}, { type: 'kids' }),
        row('inativa', '2026-11-11', {}, { is_active: false }),
        row('cancelada', '2026-11-11', { status: 'cancelled' }),
        row('ok', '2026-11-10'),
      ],
      new Map(),
      NOW,
    )
    expect(days.flatMap((d) => d.slots.map((s) => s.id))).toEqual(['ok'])
  })

  it('leva a restrição de sexo da turma para a tela', () => {
    const days = buildTrialSchedule([row('f', '2026-11-11', {}, { gender_restriction: 'F' })], new Map(), NOW)
    expect(days[0].slots[0].genderRestriction).toBe('F')
  })
})
