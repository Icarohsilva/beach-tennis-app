import { describe, it, expect } from 'vitest'
import { classifyEnrollment } from './enrollmentStatus'

describe('classifyEnrollment', () => {
  it('parceiro confirmado → elegivel', () => {
    expect(classifyEnrollment({ partner: 'wellhub', pendingPartner: null, hasActivePlan: false })).toBe('elegivel')
  })
  it('plano ativo → elegivel', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: null, hasActivePlan: true })).toBe('elegivel')
  })
  it('pending_partner sem confirmar → a_confirmar', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: 'wellhub', hasActivePlan: false })).toBe('a_confirmar')
  })
  it('nada → sem_plano', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: null, hasActivePlan: false })).toBe('sem_plano')
  })
  it('parceiro confirmado vence pending_partner diferente → elegivel', () => {
    expect(classifyEnrollment({ partner: 'wellhub', pendingPartner: 'totalpass', hasActivePlan: false })).toBe('elegivel')
  })
  it('plano ativo vence pending_partner → elegivel', () => {
    expect(classifyEnrollment({ partner: null, pendingPartner: 'totalpass', hasActivePlan: true })).toBe('elegivel')
  })
})
