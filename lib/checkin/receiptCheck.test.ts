import { describe, it, expect } from 'vitest'
import { checkReceipt, gymNameMatches, type ReceiptReading } from './receiptCheck'

// 04/10/2026 11:40 em Brasília = 14:40 UTC.
const now = new Date('2026-10-04T14:40:00Z')
const ok: ReceiptReading = {
  isWellhubCheckin: true,
  text: 'wellhub Check-in confirmado Varandas Beach 11h38 + 4 out',
  day: 4,
  month: 10,
  hour: 11,
  minute: 38,
}
const base = { now, orgName: 'Varandas Beach Futevôlei', lastTakenAt: null }

describe('checkReceipt', () => {
  it('valida o print de hoje, da academia certa', () => {
    expect(checkReceipt({ ...base, reading: ok })).toEqual({
      status: 'validated',
      takenAt: '2026-10-04T14:38:00.000Z',
      note: null,
    })
  })

  it('recusa o que não é a tela de check-in confirmado', () => {
    const r = checkReceipt({ ...base, reading: { ...ok, isWellhubCheckin: false } })
    expect(r.status).toBe('rejected')
  })

  it('recusa sem data ou hora legível', () => {
    expect(checkReceipt({ ...base, reading: { ...ok, hour: null } }).status).toBe('rejected')
  })

  it('recusa print de outro dia', () => {
    const r = checkReceipt({ ...base, reading: { ...ok, day: 3 } })
    expect(r).toMatchObject({ status: 'rejected' })
    if (r.status === 'rejected') expect(r.reason).toContain('03/10')
  })

  it('recusa hora no futuro além da folga', () => {
    expect(checkReceipt({ ...base, reading: { ...ok, hour: 12, minute: 30 } }).status).toBe('rejected')
    // Relógio do celular 5 min adiantado passa.
    expect(checkReceipt({ ...base, reading: { ...ok, hour: 11, minute: 45 } }).status).toBe('validated')
  })

  it('recusa print igual ou anterior ao último comprovante', () => {
    const last = '2026-10-04T14:38:00.000Z'
    expect(checkReceipt({ ...base, reading: ok, lastTakenAt: last }).status).toBe('rejected')
    expect(checkReceipt({ ...base, reading: { ...ok, minute: 20 }, lastTakenAt: last }).status).toBe('rejected')
    expect(checkReceipt({ ...base, reading: { ...ok, minute: 39 }, lastTakenAt: last }).status).toBe('validated')
  })

  it('academia diferente entra, mas para o admin conferir', () => {
    const r = checkReceipt({ ...base, reading: { ...ok, text: 'Check-in confirmado Smart Fit Centro' } })
    expect(r).toMatchObject({ status: 'review' })
  })
})

describe('gymNameMatches', () => {
  it('basta uma palavra significativa em comum, sem acento nem caixa', () => {
    expect(gymNameMatches('Arena Varandas', 'VARANDAS BEACH')).toBe(true)
    // Palavra genérica ("beach") sozinha não identifica a arena.
    expect(gymNameMatches('Hudson Beach Tennis', 'Varandas Beach')).toBe(false)
    expect(gymNameMatches('Hudson Tênis', 'Smart Fit')).toBe(false)
    expect(gymNameMatches('Hudson', null)).toBe(false)
  })
})
