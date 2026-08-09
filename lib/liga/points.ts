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
  // --- Fontes extras (comportamento que ajuda a academia) -------------------
  /** Confirmou a própria presença pelo app, poupando a chamada do professor. */
  selfCheckin: number
  /** Cancelou dentro da janela: é o que libera a vaga para a fila. */
  cancelInTime: number
  /** Pegou a vaga que abriu na fila de espera. */
  waitlistAccept: number
  /** Agendou com antecedência (ver EARLY_BOOKING_DAYS). */
  earlyBooking: number
  /** Completou perfil e ficha médica. Uma vez na vida. */
  profileComplete: number
  /** Reservou quadra avulsa (day use). */
  dayUse: number
}

export const DEFAULT_LIGA_WEIGHTS: LigaWeights = {
  attendance: 10,
  streakWeek: 5,
  tournamentEntry: 30,
  tournamentWin: 50,
  // Todas menores que a presença de propósito: a Liga não pode premiar mais quem
  // mexe no app do que quem aparece na quadra.
  selfCheckin: 3,
  cancelInTime: 5,
  waitlistAccept: 8,
  earlyBooking: 3,
  profileComplete: 20,
  dayUse: 5,
}

/** A partir de quantos dias de antecedência a reserva vira "antecipada". */
export const EARLY_BOOKING_DAYS = 2

/**
 * A reserva conta como antecipada?
 *
 * Compara datas puras ('YYYY-MM-DD'), sem hora: reservar na segunda para a quarta
 * conta, independentemente de ter sido 8h ou 23h. Comparar timestamps faria a mesma
 * reserva valer ou não valer dependendo do minuto, o que seria incompreensível.
 */
export function isEarlyBooking(bookedOn: string, sessionDate: string): boolean {
  const [by, bm, bd] = bookedOn.slice(0, 10).split('-').map(Number)
  const [sy, sm, sd] = sessionDate.slice(0, 10).split('-').map(Number)
  const diff = (Date.UTC(sy, sm - 1, sd) - Date.UTC(by, bm - 1, bd)) / 86400000
  return diff >= EARLY_BOOKING_DAYS
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
