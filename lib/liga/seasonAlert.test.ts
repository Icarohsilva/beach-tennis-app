import { describe, it, expect } from 'vitest'
import { seasonAlertKind, seasonAlertText, ALERT_DAYS_LEFT } from './seasonAlert'

const base = {
  daysLeft: ALERT_DAYS_LEFT,
  pointsToPromote: 20,
  inRelegationZone: false,
  points: 120,
}

describe('seasonAlertKind', () => {
  it('avisa quem está perto de subir, no dia do disparo', () => {
    expect(seasonAlertKind(base)).toBe('promocao')
  })

  it('não avisa fora do dia do disparo', () => {
    expect(seasonAlertKind({ ...base, daysLeft: 5 })).toBeNull()
    expect(seasonAlertKind({ ...base, daysLeft: 1 })).toBeNull()
    expect(seasonAlertKind({ ...base, daysLeft: 0 })).toBeNull()
  })

  it('não avisa quem nunca pontuou', () => {
    expect(seasonAlertKind({ ...base, points: 0 })).toBeNull()
    expect(seasonAlertKind({ ...base, points: 0, inRelegationZone: true })).toBeNull()
  })

  it('não avisa quando a subida está longe demais', () => {
    expect(seasonAlertKind({ ...base, pointsToPromote: 41 })).toBeNull()
  })

  it('quem já está na zona de promoção não recebe aviso de subida', () => {
    expect(seasonAlertKind({ ...base, pointsToPromote: null })).toBeNull()
  })

  it('avisa quem está caindo', () => {
    expect(
      seasonAlertKind({ ...base, pointsToPromote: null, inRelegationZone: true }),
    ).toBe('rebaixamento')
  })

  it('promoção alcançável tem prioridade sobre rebaixamento', () => {
    expect(seasonAlertKind({ ...base, pointsToPromote: 10, inRelegationZone: true })).toBe(
      'promocao',
    )
  })
})

describe('seasonAlertText', () => {
  it('fala em singular quando falta um ponto só', () => {
    const t = seasonAlertText('promocao', {
      pointsToPromote: 1,
      sportLabel: 'Beach Tennis',
      divisionLabel: 'Divisão Prata',
    })
    expect(t.title).toContain('1 ponto para subir')
  })

  it('texto de rebaixamento cita a modalidade e a divisão', () => {
    const t = seasonAlertText('rebaixamento', {
      pointsToPromote: null,
      sportLabel: 'Futevôlei',
      divisionLabel: 'Divisão Ouro',
    })
    expect(t.body).toContain('Futevôlei')
    expect(t.body).toContain('Divisão Ouro')
  })
})
