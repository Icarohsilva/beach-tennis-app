// lib/liga/streak.test.ts
import { describe, it, expect } from 'vitest'
import { computeStreakWeeks } from './streak'

// Quarta-feira, 2026-08-05. Semana ISO começa segunda 2026-08-03.
const WED = new Date('2026-08-05T12:00:00-03:00')

describe('computeStreakWeeks', () => {
  it('sem presença nenhuma é 0', () => {
    expect(computeStreakWeeks([], WED)).toBe(0)
  })

  it('presença só na semana corrente é 1', () => {
    expect(computeStreakWeeks(['2026-08-04'], WED)).toBe(1)
  })

  it('conta semanas consecutivas incluindo a corrente', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-07-28', '2026-07-21'], WED)).toBe(3)
  })

  it('duas presenças na mesma semana contam como uma semana', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-08-05'], WED)).toBe(1)
  })

  it('semana corrente ainda sem treino não quebra a sequência anterior', () => {
    // Ainda é quarta: o aluno tem o resto da semana para treinar.
    expect(computeStreakWeeks(['2026-07-28', '2026-07-21'], WED)).toBe(2)
  })

  it('buraco no meio corta a sequência na lacuna', () => {
    // 2026-07-14 existe mas 2026-07-21 não → sequência para antes dele.
    expect(computeStreakWeeks(['2026-08-04', '2026-07-28', '2026-07-14'], WED)).toBe(2)
  })

  it('presença só em semana antiga, com a anterior vazia, é 0', () => {
    expect(computeStreakWeeks(['2026-06-10'], WED)).toBe(0)
  })

  it('ignora datas futuras', () => {
    expect(computeStreakWeeks(['2026-08-04', '2026-09-01'], WED)).toBe(1)
  })

  it('atravessa a virada de ano', () => {
    // Quinta 2026-01-08; semanas: 2026-01-05, 2025-12-29, 2025-12-22.
    const jan = new Date('2026-01-08T12:00:00-03:00')
    expect(computeStreakWeeks(['2026-01-06', '2025-12-30', '2025-12-23'], jan)).toBe(3)
  })
})
