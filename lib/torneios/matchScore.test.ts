import { describe, it, expect } from 'vitest'
import {
  completeScore,
  gamesToWin,
  scoreHint,
  scoreRuleFrom,
  scoringLabel,
  scoreUnit,
  validateMatchScore,
  type MatchScoreRule,
} from './matchScore'

/** O formato pedido: Super de 5 games corridos, sem tiebreak. */
const SUPER5: MatchScoreRule = { mode: 'fixed_games', games: 5, tiebreak: false }
const SET6: MatchScoreRule = { mode: 'set', games: 6, tiebreak: true }

describe('gamesToWin', () => {
  it('5 games corridos: ganha com 3', () => {
    expect(gamesToWin(SUPER5)).toBe(3)
  })

  it('a maioria acompanha o total, sem campo separado para discordar dele', () => {
    expect(gamesToWin({ ...SUPER5, games: 3 })).toBe(2)
    expect(gamesToWin({ ...SUPER5, games: 7 })).toBe(4)
    expect(gamesToWin({ ...SUPER5, games: 9 })).toBe(5)
  })

  it('em set o alvo é o próprio número', () => {
    expect(gamesToWin(SET6)).toBe(6)
  })
})

describe('validateMatchScore — games corridos', () => {
  it('aceita placar que soma o total', () => {
    expect(validateMatchScore(3, 2, SUPER5).ok).toBe(true)
    expect(validateMatchScore(5, 0, SUPER5).ok).toBe(true)
    expect(validateMatchScore(0, 5, SUPER5).ok).toBe(true)
  })

  it('recusa partida que não terminou de ser jogada', () => {
    // O defeito que esta regra existe para impedir: 3x1 parece um placar
    // apertado, mas são 4 games num formato de 5 — e aceitá-lo tiraria 1 game
    // da contagem dos quatro jogadores daquela partida.
    const r = validateMatchScore(3, 1, SUPER5)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('5')
  })

  it('recusa soma maior que o total', () => {
    expect(validateMatchScore(4, 3, SUPER5).ok).toBe(false)
  })

  it('recusa placar não inteiro ou negativo', () => {
    expect(validateMatchScore(2.5, 2.5, SUPER5).ok).toBe(false)
    expect(validateMatchScore(-1, 6, SUPER5).ok).toBe(false)
  })

  it('em set a validação segue frouxa — torneio antigo já tem placar gravado', () => {
    expect(validateMatchScore(6, 4, SET6).ok).toBe(true)
    expect(validateMatchScore(7, 5, SET6).ok).toBe(true)
    expect(validateMatchScore(6, 0, SET6).ok).toBe(true)
  })
})

describe('completeScore', () => {
  it('em games corridos, um lado define o outro', () => {
    expect(completeScore(3, SUPER5)).toBe(2)
    expect(completeScore(0, SUPER5)).toBe(5)
  })

  it('não completa fora da faixa nem em set', () => {
    expect(completeScore(6, SUPER5)).toBeNull()
    expect(completeScore(-1, SUPER5)).toBeNull()
    expect(completeScore(4, SET6)).toBeNull()
  })
})

describe('scoreRuleFrom', () => {
  it('torneio anterior à coluna cai em set, que é o que ele sempre foi', () => {
    expect(scoreRuleFrom({ games_per_set: 6, tiebreak_games: true })).toEqual({
      mode: 'set', games: 6, tiebreak: true,
    })
    expect(scoreRuleFrom({}).mode).toBe('set')
  })

  it('lê o modo gravado', () => {
    expect(scoreRuleFrom({ games_per_set: 5, tiebreak_games: false, scoring_mode: 'fixed_games' }))
      .toEqual({ mode: 'fixed_games', games: 5, tiebreak: false })
  })
})

describe('textos', () => {
  it('a dica diz que todos os games são jogados e quantos ganham', () => {
    const hint = scoreHint(SUPER5)
    expect(hint).toContain('5 games')
    expect(hint).toContain('3')
  })

  it('o rótulo não promete set num torneio de games corridos', () => {
    expect(scoringLabel(SUPER5)).toBe('5 games corridos · vence com 3')
    expect(scoringLabel(SET6)).toBe('6 games por set com tiebreak')
  })
})

describe('Super Tiebreak', () => {
  const TB10: MatchScoreRule = { mode: 'tiebreak', games: 10, tiebreak: false }

  it('aceita quem chega ao alvo com 2 de vantagem, e a prorrogação de 2', () => {
    expect(validateMatchScore(10, 8, TB10).ok).toBe(true)
    expect(validateMatchScore(3, 10, TB10).ok).toBe(true)
    expect(validateMatchScore(12, 10, TB10).ok).toBe(true)
    expect(validateMatchScore(11, 13, TB10).ok).toBe(true)
  })

  it('recusa jogo que não acabou, empate e prorrogação sem 2 de vantagem', () => {
    expect(validateMatchScore(9, 7, TB10).ok).toBe(false)
    expect(validateMatchScore(10, 9, TB10).ok).toBe(false)
    expect(validateMatchScore(10, 10, TB10).ok).toBe(false)
    expect(validateMatchScore(13, 10, TB10).ok).toBe(false)
    expect(validateMatchScore(12, 9, TB10).error).toContain('abre 2')
  })

  it('vale para 7 e 15 pontos', () => {
    expect(validateMatchScore(7, 5, { ...TB10, games: 7 }).ok).toBe(true)
    expect(validateMatchScore(7, 6, { ...TB10, games: 7 }).ok).toBe(false)
    expect(validateMatchScore(15, 0, { ...TB10, games: 15 }).ok).toBe(true)
  })

  it('não completa o outro lado: com dois dígitos, o "1" de "10" viraria 10 x 10', () => {
    expect(completeScore(1, TB10)).toBeNull()
    expect(completeScore(8, TB10)).toBeNull()
  })

  it('textos e unidade falam em pontos', () => {
    expect(scoringLabel(TB10)).toBe('Super Tiebreak de 10 pontos')
    expect(scoreHint(TB10)).toContain('10 x 8')
    expect(scoreUnit('tiebreak')).toBe('pontos')
    expect(scoreUnit('fixed_games')).toBe('games')
    expect(scoreRuleFrom({ scoring_mode: 'tiebreak', games_per_set: 15 }).games).toBe(15)
  })
})
