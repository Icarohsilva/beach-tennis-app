// lib/utils/agenda.test.ts
import { describe, it, expect } from 'vitest'
import { greetingFor, countdownLabel, buildWeekDays, occupancyLevel, addDaysISO } from './agenda'

describe('addDaysISO', () => {
  it('soma dias dentro do mês', () => {
    expect(addDaysISO('2026-07-22', 6)).toBe('2026-07-28')
  })

  it('atravessa mês e ano', () => {
    expect(addDaysISO('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('aceita zero', () => {
    expect(addDaysISO('2026-07-22', 0)).toBe('2026-07-22')
  })
})

describe('greetingFor', () => {
  it('cobre as três faixas do dia', () => {
    expect(greetingFor(0)).toBe('Bom dia')
    expect(greetingFor(11)).toBe('Bom dia')
    expect(greetingFor(12)).toBe('Boa tarde')
    expect(greetingFor(17)).toBe('Boa tarde')
    expect(greetingFor(18)).toBe('Boa noite')
    expect(greetingFor(23)).toBe('Boa noite')
  })
})

describe('countdownLabel', () => {
  const start = new Date('2026-07-22T19:00:00').getTime()
  const end = new Date('2026-07-22T20:00:00').getTime()

  it('avisa quando a aula está em andamento', () => {
    const now = new Date('2026-07-22T19:30:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Acontecendo agora')
  })

  it('conta minutos quando falta menos de uma hora', () => {
    const now = new Date('2026-07-22T18:35:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Começa em 25 min')
  })

  it('conta horas e minutos no mesmo dia', () => {
    const now = new Date('2026-07-22T16:36:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Faltam 2h 24min')
  })

  it('omite os minutos quando a hora é cheia', () => {
    const now = new Date('2026-07-22T16:00:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Faltam 3h')
  })

  it('usa dias quando falta mais de um dia', () => {
    const now = new Date('2026-07-19T19:00:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Em 3 dias')
  })

  it('trata o dia seguinte como "Amanhã"', () => {
    const now = new Date('2026-07-21T18:00:00').getTime()
    expect(countdownLabel(start, end, now)).toBe('Amanhã')
  })

  it('sem horário de fim, considera começada depois do início', () => {
    const now = new Date('2026-07-22T19:30:00').getTime()
    expect(countdownLabel(start, null, now)).toBe('Já começou')
  })
})

describe('buildWeekDays', () => {
  it('gera N dias consecutivos a partir da data inicial', () => {
    const days = buildWeekDays('2026-07-22', 7, [])
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-07-22')
    expect(days[6].date).toBe('2026-07-28')
  })

  it('atravessa a virada do mês', () => {
    const days = buildWeekDays('2026-07-30', 3, [])
    expect(days.map((d) => d.date)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01'])
  })

  it('agrupa os itens no dia correspondente', () => {
    const items = [
      { id: 'a', date: '2026-07-22' },
      { id: 'b', date: '2026-07-24' },
      { id: 'c', date: '2026-07-22' },
    ]
    const days = buildWeekDays('2026-07-22', 3, items)
    expect(days[0].items.map((i) => i.id)).toEqual(['a', 'c'])
    expect(days[1].items).toEqual([])
    expect(days[2].items.map((i) => i.id)).toEqual(['b'])
  })

  it('descarta itens fora da janela', () => {
    const items = [{ id: 'fora', date: '2026-08-10' }]
    const days = buildWeekDays('2026-07-22', 3, items)
    expect(days.every((d) => d.items.length === 0)).toBe(true)
  })
})

describe('occupancyLevel', () => {
  it('classifica pela fração ocupada', () => {
    expect(occupancyLevel(0, 8)).toBe('low')
    expect(occupancyLevel(3, 8)).toBe('low')
    expect(occupancyLevel(4, 8)).toBe('mid')
    expect(occupancyLevel(6, 8)).toBe('high')
    expect(occupancyLevel(8, 8)).toBe('high')
  })

  it('trata capacidade zero como vazia', () => {
    expect(occupancyLevel(0, 0)).toBe('low')
  })
})
