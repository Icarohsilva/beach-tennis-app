// lib/utils/debtRules.test.ts
import { describe, it, expect } from 'vitest'
import { isBlockingDebt, summarizeDebts, type DebtRow } from './debtRules'

const NOW = new Date('2026-07-22T12:00:00Z')
const row = (over: Partial<DebtRow> = {}): DebtRow => ({
  id: 'p1', amount: 30, createdAt: '2026-07-01T10:00:00Z', receiptUrl: null, ...over,
})

describe('isBlockingDebt', () => {
  it('R$ 0 nunca bloqueia (academia sem preço configurado)', () => {
    expect(isBlockingDebt(row({ amount: 0 }), 7, NOW)).toBe(false)
  })
  it('dentro da carência não bloqueia', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-20T10:00:00Z' }), 7, NOW)).toBe(false)
  })
  it('passada a carência, com valor, bloqueia', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-01T10:00:00Z' }), 7, NOW)).toBe(true)
  })
  it('carência 0 bloqueia na hora', () => {
    expect(isBlockingDebt(row({ createdAt: '2026-07-22T09:00:00Z' }), 0, NOW)).toBe(true)
  })
  it('comprovante enviado NÃO desbloqueia (só a baixa do admin)', () => {
    expect(isBlockingDebt(row({ receiptUrl: 'p1/u1/receipt.jpg' }), 7, NOW)).toBe(true)
  })
})

describe('summarizeDebts', () => {
  it('soma total, conta e acha a mais antiga', () => {
    const s = summarizeDebts(
      [row({ id: 'a', amount: 30, createdAt: '2026-07-01T10:00:00Z' }),
       row({ id: 'b', amount: 20, createdAt: '2026-07-10T10:00:00Z' })],
      7, NOW,
    )
    expect(s.total).toBe(50)
    expect(s.count).toBe(2)
    expect(s.oldestAt).toBe('2026-07-01T10:00:00Z')
    expect(s.isBlocked).toBe(true)
  })
  it('só pendências dentro da carência → não bloqueado', () => {
    const s = summarizeDebts([row({ createdAt: '2026-07-21T10:00:00Z' })], 7, NOW)
    expect(s.isBlocked).toBe(false)
    expect(s.total).toBe(30)
  })
  it('marca aguardando conferência quando há comprovante', () => {
    const s = summarizeDebts([row({ receiptUrl: 'x' })], 7, NOW)
    expect(s.awaitingReview).toBe(1)
  })
  it('lista vazia', () => {
    const s = summarizeDebts([], 7, NOW)
    expect(s).toEqual({ total: 0, count: 0, oldestAt: null, isBlocked: false, awaitingReview: 0 })
  })
})
