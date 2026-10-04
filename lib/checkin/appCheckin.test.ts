import { describe, it, expect } from 'vitest'
import { appCheckinRef, receiptPath, resolveAppCheckin, validateReceiptFile } from './appCheckin'

describe('resolveAppCheckin', () => {
  it('libera só com a chave ligada, sem integração e para aluno Wellhub', () => {
    expect(resolveAppCheckin({ enabled: true, integrationConnected: false, partner: 'wellhub' }))
      .toEqual({ available: true })
  })

  it('chave desligada vence tudo', () => {
    expect(resolveAppCheckin({ enabled: false, integrationConnected: false, partner: 'wellhub' }))
      .toEqual({ available: false, reason: 'disabled' })
  })

  it('com a integração conectada o check-in já é automático', () => {
    expect(resolveAppCheckin({ enabled: true, integrationConnected: true, partner: 'wellhub' }))
      .toEqual({ available: false, reason: 'integration' })
  })

  it('quem não é do plano Wellhub segue o fluxo de sempre', () => {
    for (const partner of [null, undefined, 'totalpass'] as const) {
      expect(resolveAppCheckin({ enabled: true, integrationConnected: false, partner }))
        .toEqual({ available: false, reason: 'not_partner' })
    }
  })
})

describe('validateReceiptFile', () => {
  it('exige imagem de até 5 MB', () => {
    expect(validateReceiptFile(null)).toMatch(/Anexe/)
    expect(validateReceiptFile({ type: 'image/png', size: 0 })).toMatch(/Anexe/)
    expect(validateReceiptFile({ type: 'application/pdf', size: 100 })).toMatch(/Formato/)
    expect(validateReceiptFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/grande/)
    expect(validateReceiptFile({ type: 'image/webp', size: 200_000 })).toBeNull()
  })
})

describe('appCheckinRef / receiptPath', () => {
  it('um identificador por aluno e dia', () => {
    expect(appCheckinRef('u1', '2026-10-04')).toBe('app:u1:2026-10-04')
    expect(receiptPath('o1', 'u1', '2026-10-04', 'image/png')).toBe('o1/u1/2026-10-04.png')
  })
})
