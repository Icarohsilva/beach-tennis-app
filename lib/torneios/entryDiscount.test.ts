// lib/torneios/entryDiscount.test.ts
import { describe, it, expect } from 'vitest'
import { computeEntryDiscount, applyDiscount } from './entryDiscount'

describe('computeEntryDiscount', () => {
  it('primeiro torneio da semana: sem desconto', () => {
    expect(computeEntryDiscount(0, 30, 50)).toBe(0)
  })
  it('segundo torneio: aplica discount2Pct', () => {
    expect(computeEntryDiscount(1, 30, 50)).toBe(30)
  })
  it('terceiro torneio: aplica discount3Pct', () => {
    expect(computeEntryDiscount(2, 30, 50)).toBe(50)
  })
  it('quarto torneio: ainda discount3Pct', () => {
    expect(computeEntryDiscount(3, 30, 50)).toBe(50)
  })
  it('percentuais customizados funcionam', () => {
    expect(computeEntryDiscount(1, 20, 40)).toBe(20)
    expect(computeEntryDiscount(2, 20, 40)).toBe(40)
  })
  it('weeklyPaidCount negativo trata como zero', () => {
    expect(computeEntryDiscount(-1, 30, 50)).toBe(0)
  })
})

describe('applyDiscount', () => {
  it('0% desconto retorna preço cheio', () => {
    expect(applyDiscount(10000, 0)).toBe(10000)
  })
  it('30% em R$100 = R$70 (7000 centavos)', () => {
    expect(applyDiscount(10000, 30)).toBe(7000)
  })
  it('50% em R$100 = R$50 (5000 centavos)', () => {
    expect(applyDiscount(10000, 50)).toBe(5000)
  })
  it('arredonda para o centavo mais próximo', () => {
    // 333 * 0.9 = 299.7 → 300
    expect(applyDiscount(333, 10)).toBe(300)
  })
})
