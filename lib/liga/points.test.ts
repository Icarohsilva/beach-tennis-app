// lib/liga/points.test.ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LIGA_WEIGHTS,
  pointsForAttendance,
  pointsForStreakWeek,
  pointsForTournamentResult,
  isEarlyBooking,
  type LigaWeights,
} from './points'

// Espalha os defaults: as fontes extras não interessam a estes testes, e repetir
// cada peso aqui faria o arquivo quebrar toda vez que uma fonte nova entrasse.
const w: LigaWeights = {
  ...DEFAULT_LIGA_WEIGHTS,
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
    expect(DEFAULT_LIGA_WEIGHTS).toMatchObject({
      attendance: 10,
      streakWeek: 5,
      tournamentEntry: 30,
      tournamentWin: 50,
    })
  })

  it('nenhuma fonte extra vale mais que a presença', () => {
    // A Liga não pode premiar mais quem mexe no app do que quem aparece na quadra.
    // Exceção deliberada: cadastro completo é evento único na vida, não recorrente.
    const { attendance, profileComplete, ...resto } = DEFAULT_LIGA_WEIGHTS
    for (const [fonte, peso] of Object.entries(resto)) {
      if (fonte === 'tournamentEntry' || fonte === 'tournamentWin') continue
      expect(peso, `${fonte} passou da presença`).toBeLessThanOrEqual(attendance)
    }
    expect(profileComplete).toBeGreaterThan(0)
  })
})


describe('isEarlyBooking', () => {
  it('dois dias ou mais conta como antecipada', () => {
    expect(isEarlyBooking('2026-08-08', '2026-08-10')).toBe(true)
    expect(isEarlyBooking('2026-08-08', '2026-08-20')).toBe(true)
  })

  it('menos de dois dias não conta', () => {
    expect(isEarlyBooking('2026-08-08', '2026-08-09')).toBe(false)
    expect(isEarlyBooking('2026-08-08', '2026-08-08')).toBe(false)
  })

  it('aula no passado não conta', () => {
    expect(isEarlyBooking('2026-08-08', '2026-08-01')).toBe(false)
  })

  it('compara datas puras: a hora da reserva não muda o resultado', () => {
    expect(isEarlyBooking('2026-08-08T23:59:00Z', '2026-08-10T06:00:00Z')).toBe(true)
  })

  it('atravessa a virada de mês', () => {
    expect(isEarlyBooking('2026-08-30', '2026-09-01')).toBe(true)
  })
})
