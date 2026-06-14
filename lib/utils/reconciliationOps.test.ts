import { describe, it, expect } from 'vitest'
import { requiresCredit, buildReconciliationOps } from './reconciliationOps'

describe('requiresCredit', () => {
  it('is true for subscriber and per_class', () => {
    expect(requiresCredit('subscriber')).toBe(true)
    expect(requiresCredit('per_class')).toBe(true)
  })
  it('is false for wellhub and totalpass', () => {
    expect(requiresCredit('wellhub')).toBe(false)
    expect(requiresCredit('totalpass')).toBe(false)
  })
})

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-06-18' },
    { id: 's2', session_date: '2026-06-25' },
  ]

  it('creates one op per not-yet-booked session with credit flag and reasons', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), 'subscriber', 'Mensal 1x')
    expect(ops).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-06-18',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 18/06',
        debitReason: 'Matrícula fixa — aula 18/06',
      },
      {
        sessionId: 's2',
        sessionDate: '2026-06-25',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 25/06',
        debitReason: 'Matrícula fixa — aula 25/06',
      },
    ])
  })

  it('skips sessions already booked', () => {
    const ops = buildReconciliationOps(sessions, new Set(['s1']), 'subscriber', 'Mensal 1x')
    expect(ops.map((o) => o.sessionId)).toEqual(['s2'])
  })

  it('marks needsCredit false for wellhub', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), 'wellhub', 'Mensal 1x')
    expect(ops.every((o) => o.needsCredit === false)).toBe(true)
  })
})
