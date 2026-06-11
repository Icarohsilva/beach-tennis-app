// lib/utils/creditRules.test.ts
import { describe, it, expect } from 'vitest'
import { canCancelWithRefund, getMakeupCreditExpiry } from './creditRules'

describe('canCancelWithRefund', () => {
  it('allows cancellation 6 hours before', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T12:00:00-03:00'),
    ).toBe(true)
  })

  it('blocks cancellation 4 hours before', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T14:00:00-03:00'),
    ).toBe(false)
  })

  it('allows cancellation exactly at window limit (>= 5h)', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:00-03:00'),
    ).toBe(true)
  })

  it('blocks cancellation just inside the window', () => {
    expect(
      canCancelWithRefund('2026-06-11T18:00:00-03:00', '2026-06-11T13:00:01-03:00'),
    ).toBe(false)
  })
})

describe('getMakeupCreditExpiry', () => {
  it('returns a date 30 days from now by default', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 30)
    expect(expiry.toISOString().startsWith('2026-07-01')).toBe(true)
  })

  it('respects custom expiry days', () => {
    const now = new Date('2026-06-01T10:00:00Z')
    const expiry = getMakeupCreditExpiry(now, 15)
    expect(expiry.toISOString().startsWith('2026-06-16')).toBe(true)
  })
})
