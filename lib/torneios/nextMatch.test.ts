import { describe, it, expect } from 'vitest'
import { pickNextMatch, type SchedulableMatch } from './nextMatch'

// now = 2026-07-05T12:00Z (09:00 BRT). Início de hoje BRT = 2026-07-05T03:00Z.
const now = new Date('2026-07-05T12:00:00.000Z')

function m(over: Partial<SchedulableMatch> & { id: string }): SchedulableMatch {
  return { played_at: null, result_status: null, ...over }
}

describe('pickNextMatch', () => {
  it('retorna null para lista vazia', () => {
    expect(pickNextMatch([], now)).toBeNull()
  })

  it('ignora confrontos sem played_at', () => {
    expect(pickNextMatch([m({ id: 'a' }), m({ id: 'b' })], now)).toBeNull()
  })

  it('ignora confrontos já confirmados, mesmo no futuro', () => {
    const rows = [m({ id: 'a', played_at: '2026-07-10T21:00:00.000Z', result_status: 'confirmed' })]
    expect(pickNextMatch(rows, now)).toBeNull()
  })

  it('ignora confrontos agendados antes do início de hoje (BRT)', () => {
    const rows = [m({ id: 'a', played_at: '2026-07-04T20:00:00.000Z' })]
    expect(pickNextMatch(rows, now)).toBeNull()
  })

  it('inclui confronto de hoje mesmo se o horário já passou', () => {
    // 05:00Z = 02:00 BRT, depois do início de hoje (03:00Z) e antes de now
    const rows = [m({ id: 'a', played_at: '2026-07-05T05:00:00.000Z' })]
    expect(pickNextMatch(rows, now)?.id).toBe('a')
  })

  it('entre vários elegíveis, escolhe o de menor played_at', () => {
    const rows = [
      m({ id: 'later', played_at: '2026-07-08T21:00:00.000Z' }),
      m({ id: 'soon', played_at: '2026-07-06T21:00:00.000Z' }),
      m({ id: 'confirmed', played_at: '2026-07-05T21:00:00.000Z', result_status: 'confirmed' }),
    ]
    expect(pickNextMatch(rows, now)?.id).toBe('soon')
  })
})
