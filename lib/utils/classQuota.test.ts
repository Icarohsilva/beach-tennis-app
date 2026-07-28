import { describe, it, expect } from 'vitest'
import { cycleWindow, countCycleWeeks } from './classQuota'

describe('cycleWindow', () => {
  it('semanal: quarta-feira devolve a segunda e o domingo da mesma semana', () => {
    // 2026-07-29 é uma quarta-feira.
    expect(cycleWindow('2026-07-29', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: a própria segunda é o início da janela', () => {
    expect(cycleWindow('2026-07-27', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('semanal: domingo fecha a semana que começou na segunda anterior', () => {
    // 2026-08-02 é domingo. Não pode abrir uma semana nova.
    expect(cycleWindow('2026-08-02', 'weekly')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('mensal: devolve o primeiro e o último dia do mês', () => {
    expect(cycleWindow('2026-07-28', 'monthly')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('mensal: fevereiro não-bissexto termina no dia 28', () => {
    expect(cycleWindow('2026-02-10', 'monthly')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('countCycleWeeks', () => {
  it('janela semanal tem exatamente 1 semana', () => {
    expect(countCycleWeeks('2026-07-27', '2026-08-02')).toBe(1)
  })

  it('julho/2026 tem 4 segundas-feiras', () => {
    // Segundas: 06, 13, 20, 27.
    expect(countCycleWeeks('2026-07-01', '2026-07-31')).toBe(4)
  })

  it('junho/2026 tem 5 segundas-feiras', () => {
    // Segundas: 01, 08, 15, 22, 29.
    expect(countCycleWeeks('2026-06-01', '2026-06-30')).toBe(5)
  })

  it('janela de um dia que não é segunda conta zero', () => {
    expect(countCycleWeeks('2026-07-28', '2026-07-28')).toBe(0)
  })
})
