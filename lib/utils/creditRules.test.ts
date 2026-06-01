// lib/utils/creditRules.test.ts
import { describe, it, expect } from 'vitest'
import { canCancelWithRefund, getMakeupCreditExpiry, CANCELLATION_WINDOW_HOURS } from './creditRules'

describe('canCancelWithRefund', () => {
  it('allows cancellation 6 hours before', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + 6)
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(true)
  })

  it('blocks cancellation 4 hours before', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + 4)
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(false)
  })

  it('blocks cancellation exactly at window limit', () => {
    const sessionDate = new Date()
    sessionDate.setHours(sessionDate.getHours() + CANCELLATION_WINDOW_HOURS)
    // at exactly 5h: not strictly greater, so no refund
    expect(canCancelWithRefund(sessionDate.toISOString(), new Date().toISOString())).toBe(false)
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
