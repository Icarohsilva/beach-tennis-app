import { describe, it, expect } from 'vitest'
import { getMonthWindow, getRemainingMonthWindow } from './monthWindow'

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
