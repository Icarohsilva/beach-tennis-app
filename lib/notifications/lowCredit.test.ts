import { describe, it, expect } from 'vitest'
import { shouldNotifyLowCredit } from './lowCredit'

describe('shouldNotifyLowCredit', () => {
  it('dispara quando cruza de >1 para 1', () => {
    expect(shouldNotifyLowCredit(2, 1)).toBe(true)
    expect(shouldNotifyLowCredit(5, 1)).toBe(true)
  })
  it('nao dispara se ja estava em 1', () => {
    expect(shouldNotifyLowCredit(1, 1)).toBe(false)
  })
  it('nao dispara se caiu a 0', () => {
    expect(shouldNotifyLowCredit(1, 0)).toBe(false)
    expect(shouldNotifyLowCredit(2, 0)).toBe(false)
  })
  it('nao dispara em saldo alto sem cruzar 1', () => {
    expect(shouldNotifyLowCredit(5, 3)).toBe(false)
  })
  it('nao dispara em concessao (saldo sobe)', () => {
    expect(shouldNotifyLowCredit(0, 1)).toBe(false)
    expect(shouldNotifyLowCredit(1, 2)).toBe(false)
  })
})
