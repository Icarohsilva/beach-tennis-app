// lib/checkin/selfCheckinDismissStorage.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isSelfCheckinDismissed, dismissSelfCheckin } from './selfCheckinDismissStorage'

const NOW = new Date('2026-08-03T19:00:00-03:00').getTime()

beforeEach(() => {
  localStorage.clear()
})

describe('dismissSelfCheckin / isSelfCheckinDismissed', () => {
  it('não está dispensada antes de qualquer dismiss', () => {
    expect(isSelfCheckinDismissed('sess-1', NOW)).toBe(false)
  })

  it('fica dispensada depois do dismiss', () => {
    dismissSelfCheckin('sess-1', NOW)
    expect(isSelfCheckinDismissed('sess-1', NOW)).toBe(true)
  })

  it('não afeta outras sessões', () => {
    dismissSelfCheckin('sess-1', NOW)
    expect(isSelfCheckinDismissed('sess-2', NOW)).toBe(false)
  })

  it('expira depois de 24h', () => {
    dismissSelfCheckin('sess-1', NOW)
    const depois = NOW + 24 * 60 * 60 * 1000 + 1
    expect(isSelfCheckinDismissed('sess-1', depois)).toBe(false)
  })

  it('continua dispensada um instante antes de completar 24h', () => {
    dismissSelfCheckin('sess-1', NOW)
    const quaseLa = NOW + 24 * 60 * 60 * 1000 - 1
    expect(isSelfCheckinDismissed('sess-1', quaseLa)).toBe(true)
  })

  it('ignora timestamp no futuro (relógio do aparelho adiantado)', () => {
    // Grava com um "now" adiantado; ao reler com o now real (mais cedo), a
    // entrada é podada — sem isso o popup ficaria escondido indefinidamente.
    dismissSelfCheckin('sess-1', NOW + 10_000)
    expect(isSelfCheckinDismissed('sess-1', NOW)).toBe(false)
  })

  it('não lança quando localStorage está indisponível', () => {
    const original = globalThis.localStorage
    // @ts-expect-error — simula ambiente sem localStorage (ex.: navegação privada)
    delete globalThis.localStorage
    try {
      expect(() => dismissSelfCheckin('sess-1', NOW)).not.toThrow()
      expect(() => isSelfCheckinDismissed('sess-1', NOW)).not.toThrow()
    } finally {
      globalThis.localStorage = original
    }
  })

  it('sobrevive a lixo gravado na chave (JSON inválido)', () => {
    localStorage.setItem('arenahub-self-checkin-dismissed', 'não é json')
    expect(isSelfCheckinDismissed('sess-1', NOW)).toBe(false)
    expect(() => dismissSelfCheckin('sess-1', NOW)).not.toThrow()
  })
})
