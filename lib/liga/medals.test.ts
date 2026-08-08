import { describe, it, expect } from 'vitest'
import { MEDALS, MEDAL_BY_KEY, evaluateMedals, medalsForScope, type MedalStats } from './medals'

function stats(partial: Partial<MedalStats> = {}): MedalStats {
  return {
    attendanceCount: 0,
    streakWeeks: 0,
    tournamentEntries: 0,
    tournamentWins: 0,
    division: 'bronze',
    monthsSinceJoined: 0,
    earlyClassCount: 0,
    kudosGiven: 0,
    kudosReceived: 0,
    ...partial,
  }
}

describe('catálogo', () => {
  it('não tem chave repetida', () => {
    expect(MEDAL_BY_KEY.size).toBe(MEDALS.length)
  })

  it('aluno zerado não ganha medalha nenhuma', () => {
    expect(evaluateMedals(stats(), 'sport')).toEqual([])
    expect(evaluateMedals(stats(), 'global')).toEqual([])
  })

  it('separa o escopo: medalha global não sai na apuração por esporte', () => {
    const veterano = stats({ monthsSinceJoined: 24, attendanceCount: 300 })
    expect(evaluateMedals(veterano, 'sport')).not.toContain('casa_24m')
    expect(evaluateMedals(veterano, 'global')).not.toContain('aulas_250')
  })

  it('medalhasForScope cobre o catálogo inteiro', () => {
    expect(medalsForScope('sport').length + medalsForScope('global').length).toBe(MEDALS.length)
  })
})

describe('frequência', () => {
  it('49 aulas não ganha a de 50; 50 ganha', () => {
    expect(evaluateMedals(stats({ attendanceCount: 49 }), 'sport')).toEqual(['aulas_10'])
    expect(evaluateMedals(stats({ attendanceCount: 50 }), 'sport')).toEqual([
      'aulas_10',
      'aulas_50',
    ])
  })

  it('quem já tem histórico ganha as anteriores junto', () => {
    const keys = evaluateMedals(stats({ attendanceCount: 250 }), 'sport')
    expect(keys).toEqual(['aulas_10', 'aulas_50', 'aulas_100', 'aulas_250'])
  })
})

describe('sequência', () => {
  it('3 semanas não ganha; 4 ganha', () => {
    expect(evaluateMedals(stats({ streakWeeks: 3 }), 'sport')).toEqual([])
    expect(evaluateMedals(stats({ streakWeeks: 4 }), 'sport')).toEqual(['streak_4'])
  })

  it('24 semanas ganha toda a escada de sequência', () => {
    expect(evaluateMedals(stats({ streakWeeks: 24 }), 'sport')).toEqual([
      'streak_4',
      'streak_8',
      'streak_12',
      'streak_24',
    ])
  })
})

describe('torneio', () => {
  it('participar dá a de estreia, vencer dá as duas', () => {
    expect(evaluateMedals(stats({ tournamentEntries: 1 }), 'sport')).toEqual([
      'torneio_primeiro',
    ])
    expect(evaluateMedals(stats({ tournamentEntries: 1, tournamentWins: 1 }), 'sport')).toEqual([
      'torneio_primeiro',
      'torneio_vitoria',
    ])
  })
})

describe('divisão', () => {
  it('prata não ganha a de ouro', () => {
    expect(evaluateMedals(stats({ division: 'prata' }), 'sport')).toEqual([])
  })

  it('ouro ganha só a de ouro', () => {
    expect(evaluateMedals(stats({ division: 'ouro' }), 'sport')).toEqual(['divisao_ouro'])
  })

  it('diamante ganha ouro e diamante, porque passou por lá', () => {
    expect(evaluateMedals(stats({ division: 'diamante' }), 'sport')).toEqual([
      'divisao_ouro',
      'divisao_diamante',
    ])
  })
})

describe('madrugador e tempo de casa', () => {
  it('9 aulas cedo não ganha; 10 ganha', () => {
    expect(evaluateMedals(stats({ earlyClassCount: 9 }), 'sport')).toEqual([])
    expect(evaluateMedals(stats({ earlyClassCount: 10 }), 'sport')).toEqual(['madrugador'])
  })

  it('elogios recebidos e dados têm escadas separadas', () => {
    expect(evaluateMedals(stats({ kudosReceived: 9 }), 'global')).toEqual([])
    expect(evaluateMedals(stats({ kudosReceived: 10 }), 'global')).toEqual([
      'elogios_recebidos_10',
    ])
    expect(evaluateMedals(stats({ kudosGiven: 50, kudosReceived: 50 }), 'global')).toEqual([
      'elogios_recebidos_10',
      'elogios_recebidos_50',
      'elogios_dados_10',
      'elogios_dados_50',
    ])
  })

  it('tempo de casa é escada e acumula', () => {
    expect(evaluateMedals(stats({ monthsSinceJoined: 5 }), 'global')).toEqual([])
    expect(evaluateMedals(stats({ monthsSinceJoined: 6 }), 'global')).toEqual(['casa_6m'])
    expect(evaluateMedals(stats({ monthsSinceJoined: 24 }), 'global')).toEqual([
      'casa_6m',
      'casa_12m',
      'casa_24m',
    ])
  })
})
