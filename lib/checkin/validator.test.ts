import { describe, it, expect } from 'vitest'
import { manualValidator, getValidator } from './validator'

describe('manualValidator', () => {
  it('always validates and propagates the code as externalRef', async () => {
    const r = await manualValidator.validate({
      partner: 'wellhub',
      studentId: 's1',
      partnerMemberId: 'WH123',
      code: 'ABC',
    })
    expect(r).toEqual({ valid: true, validation: 'manual', externalRef: 'ABC' })
  })

  it('validates without a code (externalRef undefined)', async () => {
    const r = await manualValidator.validate({
      partner: 'totalpass',
      studentId: 's1',
      partnerMemberId: null,
    })
    expect(r.valid).toBe(true)
    expect(r.validation).toBe('manual')
    expect(r.externalRef).toBeUndefined()
  })
})

describe('getValidator', () => {
  it('returns the manual validator for both partners (for now)', () => {
    expect(getValidator('wellhub')).toBe(manualValidator)
    expect(getValidator('totalpass')).toBe(manualValidator)
  })
})
