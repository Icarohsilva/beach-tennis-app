// lib/billing/fees.test.ts
import { describe, it, expect } from 'vitest'
import { computeMarketplaceFee } from './fees'

describe('computeMarketplaceFee', () => {
  it('pct 0 → fee 0 (comissão desligada no lançamento)', () => {
    expect(computeMarketplaceFee(199.9, 0)).toBe(0)
  })

  it('calcula percentual com 2 casas', () => {
    expect(computeMarketplaceFee(100, 2)).toBe(2)
    expect(computeMarketplaceFee(199.9, 1.5)).toBe(3)   // 2.9985 → 3.00
    expect(computeMarketplaceFee(33.33, 10)).toBe(3.33) // 3.333 → 3.33
  })

  it('entradas inválidas → 0 (nunca cobrar fee por engano)', () => {
    expect(computeMarketplaceFee(100, -1)).toBe(0)
    expect(computeMarketplaceFee(100, NaN)).toBe(0)
    expect(computeMarketplaceFee(-10, 5)).toBe(0)
    expect(computeMarketplaceFee(100, 101)).toBe(0)
  })
})
