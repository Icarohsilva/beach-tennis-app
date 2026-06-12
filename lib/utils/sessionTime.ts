// lib/utils/sessionTime.ts

/** Offset fixo de Brasília (sem horário de verão desde 2019). */
export const BRT_OFFSET = '-03:00'

/**
 * Monta o instante ISO do início de uma sessão a partir de
 * session_date (YYYY-MM-DD) e start_time (HH:MM ou HH:MM:SS),
 * ancorado no fuso de Brasília — independe do fuso do servidor.
 */
export function sessionStartIso(sessionDate: string, startTime: string): string {
  let time: string
  if (/^\d{2}:\d{2}$/.test(startTime)) {
    time = `${startTime}:00`
  } else if (/^\d{2}:\d{2}:\d{2}$/.test(startTime)) {
    time = startTime
  } else {
    throw new Error(`sessionStartIso: formato de hora inesperado "${startTime}"`)
  }
  return `${sessionDate}T${time}${BRT_OFFSET}`
}
