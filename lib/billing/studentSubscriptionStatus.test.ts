// lib/billing/studentSubscriptionStatus.test.ts
import { describe, it, expect } from 'vitest'
import { mapStudentPreapprovalStatus } from './studentSubscriptionStatus'

describe('mapStudentPreapprovalStatus', () => {
  it('authorized → active', () => {
    expect(mapStudentPreapprovalStatus('authorized')).toBe('active')
  })
  it('paused → past_due', () => {
    expect(mapStudentPreapprovalStatus('paused')).toBe('past_due')
  })
  it('cancelled → cancelled', () => {
    expect(mapStudentPreapprovalStatus('cancelled')).toBe('cancelled')
  })
  it('pending → pending_payment', () => {
    expect(mapStudentPreapprovalStatus('pending')).toBe('pending_payment')
  })
  it('desconhecido/undefined → null (webhook não altera nada)', () => {
    expect(mapStudentPreapprovalStatus('whatever')).toBeNull()
    expect(mapStudentPreapprovalStatus(undefined)).toBeNull()
  })
})
