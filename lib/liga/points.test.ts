// lib/liga/points.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIGA_WEIGHTS,
  pointsForAttendance,
  pointsForStreakWeek,
  pointsForTournamentResult,
  type LigaWeights,
} from './points'

const w: LigaWeights = {
  attendance: 10,
  streakWeek: 5,
  tournamentEntry: 30,
  tournamentWin: 50,
}

describe('pointsForAttendance', () => {
  it('devolve o peso configurado', () => {
    expect(pointsForAttendance(w)).toBe(10)
  })
})

describe('pointsForStreakWeek', () => {
  it('primeira semana vale o peso base', () => {
    expect(pointsForStreakWeek(1, w)).toBe(5)
  })

  it('cresce com a sequência', () => {
    expect(pointsForStreakWeek(2, w)).toBe(10)
    expect(pointsForStreakWeek(3, w)).toBe(15)
  })

  it('estabiliza no teto de 4x para não inflacionar sem limite', () => {
    expect(pointsForStreakWeek(4, w)).toBe(20)
    expect(pointsForStreakWeek(12, w)).toBe(20)
    expect(pointsForStreakWeek(99, w)).toBe(20)
  })

  it('sequência 0 não vale ponto', () => {
    expect(pointsForStreakWeek(0, w)).toBe(0)
  })
})

describe('pointsForTournamentResult', () => {
  it('primeiro lugar leva o peso cheio', () => {
    expect(pointsForTournamentResult(1, w)).toBe(50)
  })

  it('segundo leva 60% e terceiro 30%, arredondados', () => {
    expect(pointsForTournamentResult(2, w)).toBe(30)
    expect(pointsForTournamentResult(3, w)).toBe(15)
  })

  it('fora do pódio não pontua no resultado', () => {
    expect(pointsForTournamentResult(null, w)).toBe(0)
  })

  it('arredonda em vez de deixar fração', () => {
    const odd: LigaWeights = { ...w, tournamentWin: 55 }
    expect(pointsForTournamentResult(2, odd)).toBe(33)
    expect(pointsForTournamentResult(3, odd)).toBe(17)
  })
})

describe('DEFAULT_LIGA_WEIGHTS', () => {
  it('bate com os defaults documentados na spec', () => {
    expect(DEFAULT_LIGA_WEIGHTS).toEqual({
      attendance: 10,
      streakWeek: 5,
      tournamentEntry: 30,
      tournamentWin: 50,
    })
  })
})
