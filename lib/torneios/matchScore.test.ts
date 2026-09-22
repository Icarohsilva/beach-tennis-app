import { describe, it, expect } from 'vitest'
import {
  completeScore,
  gamesToWin,
  scoreHint,
  scoreRuleFrom,
  scoringLabel,
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
