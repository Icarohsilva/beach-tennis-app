export interface SessionStart {
  id: string
  /** Instante ISO do início. Monte com sessionStartIso() — ancorado em BRT. */
  startsAt: string
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Devolve o id da sessão cuja janela [início - windowHours, início + windowHours]
 * contém o check-in. Havendo mais de uma, a mais próxima do horário do check-in;
 * em empate exato, a primeira da lista (determinístico).
 *
 * Puro: compara instantes. O fuso é responsabilidade de quem monta `startsAt`.
 */
export function findSessionInWindow(
  sessions: SessionStart[],
  checkinAt: string,
  windowHours = 1,
): string | null {
  const at = new Date(checkinAt).getTime()
  const windowMs = windowHours * HOUR_MS

  let bestId: string | null = null
  let bestDistance = Infinity

  for (const s of sessions) {
    const distance = Math.abs(new Date(s.startsAt).getTime() - at)
    if (distance <= windowMs && distance < bestDistance) {
      bestDistance = distance
      bestId = s.id
    }
  }

  return bestId
}
