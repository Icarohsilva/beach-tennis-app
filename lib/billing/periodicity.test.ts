// lib/billing/periodicity.test.ts
import { describe, it, expect } from 'vitest'
import {
  PERIODICITIES,
  PERIODICITY_MONTHS,
  PERIODICITY_LABELS,
  addMonthsClamped,
  addPeriod,
  isSubscriptionCurrent,
} from './periodicity'

describe('periodicity', () => {
  it('mapeia meses por periodicidade', () => {
    expect(PERIODICITY_MONTHS.monthly).toBe(1)
    expect(PERIODICITY_MONTHS.bimonthly).toBe(2)
    expect(PERIODICITY_MONTHS.quarterly).toBe(3)
    expect(PERIODICITY_MONTHS.semiannual).toBe(6)
    expect(PERIODICITY_MONTHS.annual).toBe(12)
  })

  it('tem label pt-BR para toda periodicidade', () => {
    for (const p of PERIODICITIES) {
      expect(PERIODICITY_LABELS[p]).toBeTruthy()
    }
    expect(PERIODICITY_LABELS.bimonthly).toBe('Bimestral')
  })

  it('addMonthsClamped soma meses clampando o dia (31/jan + 1m → 28/fev)', () => {
    const d = addMonthsClamped(new Date(2026, 0, 31), 1) // 31/jan/2026
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(1) // fevereiro
    expect(d.getDate()).toBe(28)
  })

  it('addMonthsClamped preserva o dia quando cabe', () => {
    const d = addMonthsClamped(new Date(2026, 3, 15), 3) // 15/abr + 3m
    expect(d.getMonth()).toBe(6) // julho
    expect(d.getDate()).toBe(15)
  })

  it('addPeriod usa os meses da periodicidade', () => {
    const d = addPeriod(new Date(2026, 0, 10), 'annual')
    expect(d.getFullYear()).toBe(2027)
    expect(d.getMonth()).toBe(0)
  })

  it('isSubscriptionCurrent: manual sempre em dia', () => {
    expect(isSubscriptionCurrent({ gateway: 'manual', current_period_end: null })).toBe(true)
  })

  it('isSubscriptionCurrent: mercadopago exige current_period_end no futuro', () => {
    const now = new Date('2026-07-03T12:00:00Z')
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: '2026-08-01T00:00:00Z' }, now,
    )).toBe(true)
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: '2026-07-01T00:00:00Z' }, now,
    )).toBe(false)
    expect(isSubscriptionCurrent(
      { gateway: 'mercadopago', current_period_end: null }, now,
    )).toBe(false)
  })
})
