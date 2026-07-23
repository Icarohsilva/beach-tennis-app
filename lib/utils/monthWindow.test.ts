import { describe, it, expect } from 'vitest'
import { getMonthWindow, getRemainingMonthWindow, getWeekWindow, shiftWindow } from './monthWindow'

describe('getMonthWindow', () => {
  it('returns first and last day of the month', () => {
    expect(getMonthWindow(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })

  it('handles February in a non-leap year', () => {
    expect(getMonthWindow(new Date(2026, 1, 10))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('getRemainingMonthWindow', () => {
  it('returns today through the last day of the month', () => {
    expect(getRemainingMonthWindow(new Date(2026, 5, 14))).toEqual({
      from: '2026-06-14',
      to: '2026-06-30',
    })
  })

  it('on the first day returns the whole month', () => {
    expect(getRemainingMonthWindow(new Date(2026, 5, 1))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })
})

describe('getWeekWindow', () => {
  it('vai de domingo a sábado da semana da data', () => {
    // 2026-07-22 é uma quarta-feira
    expect(getWeekWindow(new Date(2026, 6, 22))).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })

  it('trata o próprio domingo como início da semana', () => {
    expect(getWeekWindow(new Date(2026, 6, 19))).toEqual({ from: '2026-07-19', to: '2026-07-25' })
  })
})

describe('shiftWindow', () => {
  it('anda semanas para trás', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', -1)).toEqual({ from: '2026-07-12', to: '2026-07-18' })
  })

  it('anda meses para trás atravessando o ano', () => {
    const w = getMonthWindow(new Date(2026, 0, 15))
    expect(shiftWindow(w, 'month', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('anda para a frente', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', 1)).toEqual({ from: '2026-07-26', to: '2026-08-01' })
  })
})
