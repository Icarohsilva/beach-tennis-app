import { describe, it, expect } from 'vitest'
import { countDistinctDays } from './monthlyProgress'

describe('countDistinctDays', () => {
  it('lista vazia → 0', () => {
    expect(countDistinctDays([])).toBe(0)
  })

  it('dois check-ins no mesmo dia → 1 (a regra da spec)', () => {
    expect(
      countDistinctDays([{ checkin_date: '2026-07-14' }, { checkin_date: '2026-07-14' }]),
    ).toBe(1)
  })

  it('dois check-ins em dias diferentes → 2', () => {
    expect(
      countDistinctDays([{ checkin_date: '2026-07-14' }, { checkin_date: '2026-07-15' }]),
    ).toBe(2)
  })

  it('mistura: 3 linhas em 2 dias → 2', () => {
    expect(
      countDistinctDays([
        { checkin_date: '2026-07-14' },
        { checkin_date: '2026-07-15' },
        { checkin_date: '2026-07-14' },
      ]),
    ).toBe(2)
  })
})
