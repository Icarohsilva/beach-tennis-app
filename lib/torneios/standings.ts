// lib/torneios/standings.ts
import type {
  EntryRef,
  MatchResultInput,
  ScoringConfig,
  StandingRow,
} from './types'

export function computeStandings(
  entries: EntryRef[],
  matches: MatchResultInput[],
  _config: ScoringConfig,
): StandingRow[] {
  const rows = new Map<string, StandingRow>()
  const ensure = (id: string): StandingRow => {
    let row = rows.get(id)
    if (!row) {
      row = { playerId: id, played: 0, wins: 0, gamesFor: 0, gamesAgainst: 0, diff: 0, points: 0 }
      rows.set(id, row)
    }
    return row
  }

  // Garante uma linha por jogador inscrito (inclui partner em dupla fixa).
  for (const e of entries) {
    ensure(e.playerId)
    if (e.partnerId) ensure(e.partnerId)
  }

  for (const m of matches) {
    if (m.result_status !== 'confirmed') continue
    const side1 = [m.player1_id, m.partner1_id].filter((x): x is string => !!x)
    const side2 = [m.player2_id, m.partner2_id].filter((x): x is string => !!x)
    const s1won = m.games1 > m.games2
    const s2won = m.games2 > m.games1

    for (const id of side1) {
      const row = ensure(id)
      row.played++
      row.gamesFor += m.games1
      row.gamesAgainst += m.games2
      if (s1won) row.wins++
    }
    for (const id of side2) {
      const row = ensure(id)
      row.played++
      row.gamesFor += m.games2
      row.gamesAgainst += m.games1
      if (s2won) row.wins++
    }
  }

  const list = Array.from(rows.values())
  for (const r of list) {
    r.diff = r.gamesFor - r.gamesAgainst
    r.points = r.wins
  }

  list.sort(
    (a, b) =>
      b.diff - a.diff ||
      b.gamesFor - a.gamesFor ||
      b.wins - a.wins ||
      a.playerId.localeCompare(b.playerId),
  )
  return list
}
