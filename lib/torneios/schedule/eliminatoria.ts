// lib/torneios/schedule/eliminatoria.ts
// Mata-mata: chave completa gerada de uma vez, com bye e cabeça-de-chave.
//
// A chave inteira nasce junto — semifinal e final já existem como partidas sem
// nome — e vai ganhando nome conforme os resultados entram. Gerar rodada a
// rodada seria mais simples, mas aí o aluno nunca veria o caminho até a final,
// que é metade da graça de um mata-mata.
import type { EntryRef, MatchPlan, MatchResultInput, RoundPlan, ScoringConfig, StandingRow } from '../types'
import { bracketSize, matchesInRound, roundsForSize, seedOrder, winnerSlot } from '../bracket'

/** Teto de participantes. 64 já são 6 rodadas; acima disso é outro produto. */
export const MAX_ELIMINATION_ENTRIES = 64

export function generateEliminationBracket(entries: EntryRef[]): RoundPlan[] {
  const n = entries.length
  if (n < 2) throw new Error('A eliminatória precisa de pelo menos 2 inscritos.')
  if (n > MAX_ELIMINATION_ENTRIES) {
    throw new Error(`A eliminatória aceita no máximo ${MAX_ELIMINATION_ENTRIES} inscritos.`)
  }

  const size = bracketSize(n)
  const totalRounds = roundsForSize(size)
  const order = seedOrder(size)

  // A ordem de chegada é a ordem de seed: entries[0] é o cabeça 1. Seed acima
  // do número de inscritos é vaga fantasma — o adversário passa direto (bye).
  const bySeed = (seed: number): EntryRef | null => (seed <= n ? entries[seed - 1] : null)

  // Lados já definidos antes de qualquer jogo: quem recebeu bye.
  const prefilled = new Map<string, EntryRef>()
  const slotKey = (round: number, matchNo: number, slot: 1 | 2) => `${round}:${matchNo}:${slot}`

  const firstRound: MatchPlan[] = []
  for (let i = 0; i < size / 2; i++) {
    const matchNo = i + 1
    const left = bySeed(order[i * 2])
    const right = bySeed(order[i * 2 + 1])

    if (left && right) {
      firstRound.push({
        p1: left.playerId,
        partner1: left.partnerId,
        p2: right.playerId,
        partner2: right.partnerId,
        matchNo,
      })
      continue
    }

    // Bye: ninguém joga esta partida, ela simplesmente não existe. Quem passou
    // já aparece posicionado na rodada seguinte.
    const advancing = left ?? right
    if (!advancing) continue
    const dest = winnerSlot(1, matchNo, totalRounds)
    if (dest) prefilled.set(slotKey(dest.round, dest.matchNo, dest.slot), advancing)
  }

  const plan: RoundPlan[] = [{ round: 1, matches: firstRound, resting: [] }]

  for (let round = 2; round <= totalRounds; round++) {
    const matches: MatchPlan[] = []
    for (let matchNo = 1; matchNo <= matchesInRound(size, round); matchNo++) {
      const left = prefilled.get(slotKey(round, matchNo, 1)) ?? null
      const right = prefilled.get(slotKey(round, matchNo, 2)) ?? null
      matches.push({
        p1: left?.playerId ?? null,
        partner1: left?.partnerId ?? null,
        p2: right?.playerId ?? null,
        partner2: right?.partnerId ?? null,
        matchNo,
      })
    }
    plan.push({ round, matches, resting: [] })
  }

  return plan
}

/**
 * Classificação de mata-mata: vale até onde você chegou, não o saldo de games.
 *
 * Quem perdeu a final é vice mesmo tendo saldo pior que um semifinalista — é
 * assim que todo torneio eliminatório funciona, e ordenar por saldo (como faz o
 * americano) poria o campeão em quarto.
 */
export function computeEliminationStandings(
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
  for (const e of entries) {
    ensure(e.playerId)
    if (e.partnerId) ensure(e.partnerId)
  }

  // Até que rodada cada um foi, e se saiu de lá vencendo.
  const lastRound = new Map<string, number>()
  const survived = new Map<string, boolean>()

  for (const m of matches) {
    if (m.result_status !== 'confirmed') continue
    const round = m.round ?? 1
    const side1 = [m.player1_id, m.partner1_id].filter((x): x is string => !!x)
    const side2 = [m.player2_id, m.partner2_id].filter((x): x is string => !!x)
    const s1won = m.games1 > m.games2
    const s2won = m.games2 > m.games1

    const apply = (ids: string[], forGames: number, against: number, won: boolean) => {
      for (const id of ids) {
        const row = ensure(id)
        row.played++
        row.gamesFor += forGames
        row.gamesAgainst += against
        if (won) row.wins++
        // Empate de rodada não existe em chave; a maior rodada é sempre a última.
        if (round >= (lastRound.get(id) ?? 0)) {
          lastRound.set(id, round)
          survived.set(id, won)
        }
      }
    }
    apply(side1, m.games1, m.games2, s1won)
    apply(side2, m.games2, m.games1, s2won)
  }

  const list = Array.from(rows.values())
  for (const r of list) {
    r.diff = r.gamesFor - r.gamesAgainst
    r.points = r.wins
  }

  // Vencer a rodada N vale mais que perdê-la, e perder a rodada N vale mais que
  // vencer a N-1: campeão, vice, semifinalistas, e por aí.
  const progress = (id: string) => (lastRound.get(id) ?? 0) * 2 + (survived.get(id) ? 1 : 0)

  list.sort(
    (a, b) =>
      progress(b.playerId) - progress(a.playerId) ||
      b.wins - a.wins ||
      b.diff - a.diff ||
      b.gamesFor - a.gamesFor ||
      a.playerId.localeCompare(b.playerId),
  )
  return list
}
