// lib/liga/seasonCloseNotice.test.ts
import { describe, it, expect } from 'vitest'
import { bestOutcome, seasonCloseOutcome, seasonCloseText } from './seasonCloseNotice'

describe('seasonCloseOutcome', () => {
  it('quem terminou com zero ponto não recebe nada, nem se caiu de divisão', () => {
    expect(seasonCloseOutcome({ champion: false, moved: 'down', points: 0 })).toBeNull()
    expect(seasonCloseOutcome({ champion: true, moved: 'up', points: 0 })).toBeNull()
  })

  it('campeão que subiu vira um desfecho só', () => {
    expect(seasonCloseOutcome({ champion: true, moved: 'up', points: 120 })).toBe('campeao_subiu')
  })

  it('campeão que ficou (topo da escada) é avisado assim mesmo', () => {
    expect(seasonCloseOutcome({ champion: true, moved: null, points: 300 })).toBe('campeao')
  })

  it('subiu e caiu, sem título', () => {
    expect(seasonCloseOutcome({ champion: false, moved: 'up', points: 80 })).toBe('subiu')
    expect(seasonCloseOutcome({ champion: false, moved: 'down', points: 10 })).toBe('caiu')
  })

  it('quem pontuou mas não se moveu nem foi campeão não recebe nada', () => {
    expect(seasonCloseOutcome({ champion: false, moved: null, points: 50 })).toBeNull()
  })
})

describe('bestOutcome', () => {
  it('boa notícia ganha da ruim, independente da ordem', () => {
    expect(bestOutcome('caiu', 'subiu')).toBe('subiu')
    expect(bestOutcome('subiu', 'caiu')).toBe('subiu')
  })

  it('título ganha de promoção simples', () => {
    expect(bestOutcome('subiu', 'campeao')).toBe('campeao')
    expect(bestOutcome('campeao', 'campeao_subiu')).toBe('campeao_subiu')
  })
})

describe('seasonCloseText', () => {
  const params = { sportLabel: 'Beach Tennis', fromLabel: 'Divisão Prata', toLabel: 'Divisão Ouro' }

  it('cita a divisão de destino em quem subiu', () => {
    const t = seasonCloseText('subiu', params)
    expect(t.title).toContain('Divisão Ouro')
    expect(t.body).toContain('Divisão Prata')
  })

  it('rebaixamento convida a voltar em vez de só anunciar a queda', () => {
    const t = seasonCloseText('caiu', {
      sportLabel: 'Beach Tennis',
      fromLabel: 'Divisão Ouro',
      toLabel: 'Divisão Prata',
    })
    expect(t.body).toContain('dá para voltar')
  })

  it('campeão sem promoção não promete divisão nova', () => {
    const t = seasonCloseText('campeao', {
      sportLabel: 'Padel',
      fromLabel: 'Divisão Diamante',
      toLabel: null,
    })
    expect(t.title).toContain('Divisão Diamante')
    expect(t.body).not.toContain('null')
  })
})
