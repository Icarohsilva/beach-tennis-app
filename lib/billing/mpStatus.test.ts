// lib/billing/mpStatus.test.ts
import { describe, it, expect } from 'vitest'
import { mapPreapprovalStatus } from './mpStatus'

describe('mapPreapprovalStatus', () => {
  it('authorized → active', () => {
    expect(mapPreapprovalStatus('authorized')).toBe('active')
  })
  it('paused → past_due', () => {
    expect(mapPreapprovalStatus('paused')).toBe('past_due')
  })
  it('cancelled → canceled', () => {
    expect(mapPreapprovalStatus('cancelled')).toBe('canceled')
  })
  it('status desconhecido → null (não altera o registro)', () => {
    expect(mapPreapprovalStatus('pending')).toBeNull()
    expect(mapPreapprovalStatus('')).toBeNull()
    expect(mapPreapprovalStatus(undefined)).toBeNull()
  })
})
