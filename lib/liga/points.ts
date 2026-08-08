// lib/liga/points.ts
// Quanto vale cada evento na Liga (spec §Fase 1 / Config por academia).
//
// Os pesos vêm de system_settings por academia; estes são os defaults. A leitura
// fica em features/liga/settings.ts — aqui só a aritmética, pura e testável.

export interface LigaWeights {
  attendance: number
  streakWeek: number
  tournamentEntry: number
  tournamentWin: number
}

export const DEFAULT_LIGA_WEIGHTS: LigaWeights = {
  attendance: 10,
  streakWeek: 5,
  tournamentEntry: 30,
  tournamentWin: 50,
}

/** Teto do multiplicador de sequência: a partir daqui o bônus semanal estabiliza. */
const STREAK_MULTIPLIER_CAP = 4

export function pointsForAttendance(w: LigaWeights): number {
  return w.attendance
}

/**
 * Bônus da semana, crescente com a sequência e com teto.
 *
 * O teto existe porque sem ele o aluno de 40 semanas ganharia 200 pontos por semana
 * e nenhum novato jamais entraria na disputa — o oposto do que a temporada que zera
 * está tentando resolver.
 */
export function pointsForStreakWeek(streakWeeks: number, w: LigaWeights): number {
  if (streakWeeks <= 0) return 0
  return w.streakWeek * Math.min(streakWeeks, STREAK_MULTIPLIER_CAP)
}

/** Bônus de pódio. Fora do pódio o aluno já recebeu `tournamentEntry` por participar. */
export function pointsForTournamentResult(place: 1 | 2 | 3 | null, w: LigaWeights): number {
  if (place === 1) return w.tournamentWin
  if (place === 2) return Math.round(w.tournamentWin * 0.6)
  if (place === 3) return Math.round(w.tournamentWin * 0.3)
  return 0
}
