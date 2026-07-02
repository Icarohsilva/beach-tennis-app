// lib/torneios/nextMatch.ts
import { startOfTodayBrt } from './matchTime'

export interface SchedulableMatch {
  id: string
  played_at: string | null
  result_status: 'pending' | 'confirmed' | null
}

/** Próximo confronto agendado (não confirmado) a partir do início de hoje (BRT). */
export function pickNextMatch<T extends SchedulableMatch>(matches: T[], now: Date): T | null {
  const threshold = startOfTodayBrt(now).getTime()
  let best: T | null = null
  let bestTime = Infinity
  for (const match of matches) {
    if (!match.played_at) continue
    if (match.result_status === 'confirmed') continue
    const t = new Date(match.played_at).getTime()
    if (Number.isNaN(t) || t < threshold) continue
    if (t < bestTime) {
      bestTime = t
      best = match
    }
  }
  return best
}
