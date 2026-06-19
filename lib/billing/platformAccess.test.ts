// lib/billing/platformAccess.test.ts
import { describe, it, expect } from 'vitest'
import { computePlatformAccess } from './platformAccess'

const NOW = new Date('2026-06-19T12:00:00Z')
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400000).toISOString()

describe('computePlatformAccess', () => {
  it('trial em dia → liberado, daysLeft arredonda pra cima', () => {
    const r = computePlatformAccess(
      { status: 'trialing', trialEndsAt: inDays(15), currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(15)
  })

  it('trial vencido → bloqueado, daysLeft 0', () => {
    const r = computePlatformAccess(
      { status: 'trialing', trialEndsAt: inDays(-1), currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
    expect(r.daysLeft).toBe(0)
  })

  it('active no prazo → liberado', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: inDays(20) },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBe(20)
  })

  it('active vencido → bloqueado', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: inDays(-3) },
      NOW,
    )
    expect(r.allowed).toBe(false)
    expect(r.daysLeft).toBe(0)
  })

  it('past_due → bloqueado mesmo com current_period_end futuro', () => {
    const r = computePlatformAccess(
      { status: 'past_due', trialEndsAt: null, currentPeriodEnd: inDays(5) },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('canceled → bloqueado', () => {
    const r = computePlatformAccess(
      { status: 'canceled', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('active sem current_period_end → bloqueado (dados inconsistentes)', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: null },
      NOW,
    )
    expect(r.allowed).toBe(false)
  })

  it('vitalício (2099) → liberado com daysLeft grande', () => {
    const r = computePlatformAccess(
      { status: 'active', trialEndsAt: null, currentPeriodEnd: '2099-12-31T00:00:00Z' },
      NOW,
    )
    expect(r.allowed).toBe(true)
    expect(r.daysLeft).toBeGreaterThan(1000)
  })
})
