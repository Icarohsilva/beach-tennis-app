// lib/torneios/invite.test.ts
import { describe, it, expect } from 'vitest'
import { inviteState, inviteExpiry } from './invite'

const NOW = new Date('2026-08-20T12:00:00Z')

describe('inviteState', () => {
  it('sem aceite/recusa e prazo no futuro: pending', () => {
    const s = inviteState({ expires_at: '2026-08-21T00:00:00Z', accepted_at: null, declined_at: null }, NOW)
    expect(s).toBe('pending')
  })

  it('prazo vencido sem aceite/recusa: expired', () => {
    const s = inviteState({ expires_at: '2026-08-19T00:00:00Z', accepted_at: null, declined_at: null }, NOW)
    expect(s).toBe('expired')
  })

  it('aceito vence mesmo com prazo já vencido', () => {
    const s = inviteState(
      { expires_at: '2026-08-19T00:00:00Z', accepted_at: '2026-08-18T00:00:00Z', declined_at: null },
      NOW,
    )
    expect(s).toBe('accepted')
  })

  it('recusado vence expiração', () => {
    const s = inviteState(
      { expires_at: '2026-08-19T00:00:00Z', accepted_at: null, declined_at: '2026-08-18T00:00:00Z' },
      NOW,
    )
    expect(s).toBe('declined')
  })

  it('aceito tem precedência sobre recusado (não deveria coexistir, mas a ordem é definida)', () => {
    const s = inviteState(
      { expires_at: '2026-08-21T00:00:00Z', accepted_at: '2026-08-19T00:00:00Z', declined_at: '2026-08-19T00:00:00Z' },
      NOW,
    )
    expect(s).toBe('accepted')
  })

  it('prazo exatamente igual a now conta como expirado (fronteira)', () => {
    const s = inviteState({ expires_at: NOW.toISOString(), accepted_at: null, declined_at: null }, NOW)
    expect(s).toBe('expired')
  })
})

describe('inviteExpiry', () => {
  it('sem prazo de inscrição, usa 48h a partir de agora', () => {
    const iso = inviteExpiry(NOW, null)
    expect(new Date(iso).getTime() - NOW.getTime()).toBe(48 * 60 * 60 * 1000)
  })

  it('prazo de inscrição mais distante que 48h: usa as 48h', () => {
    const deadline = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const iso = inviteExpiry(NOW, deadline)
    expect(new Date(iso).getTime() - NOW.getTime()).toBe(48 * 60 * 60 * 1000)
  })

  it('prazo de inscrição mais perto que 48h: usa o prazo (clamp)', () => {
    const deadline = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString()
    const iso = inviteExpiry(NOW, deadline)
    expect(iso).toBe(deadline)
  })
})
