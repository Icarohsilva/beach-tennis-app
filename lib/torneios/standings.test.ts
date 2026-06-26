// lib/torneios/standings.test.ts
import { describe, it, expect } from 'vitest'
import { computeStandings } from './standings'
import type { EntryRef, MatchResultInput, ScoringConfig } from './types'

const config: ScoringConfig = { sets_to_win: 1, games_per_set: 6, tiebreak_games: true }
const entries: EntryRef[] = [
  { playerId: 'a', partnerId: null },
  { playerId: 'b', partnerId: null },
  { playerId: 'c', partnerId: null },
  { playerId: 'd', partnerId: null },
]

function match(p1: string, pa1: string, p2: string, pa2: string, g1: number, g2: number, status: MatchResultInput['result_status']): MatchResultInput {
  return { player1_id: p1, partner1_id: pa1, player2_id: p2, partner2_id: pa2, games1: g1, games2: g2, result_status: status }
}

describe('computeStandings', () => {
  it('agrega games por jogador e ignora pending/sem resultado', () => {
    const matches = [
      match('a', 'b', 'c', 'd', 6, 4, 'confirmed'), // a,b +6/-4 ; c,d +4/-6
      match('a', 'c', 'b', 'd', 6, 2, 'pending'), // ignorada
      match('a', 'd', 'b', 'c', 3, 3, null), // ignorada
    ]
    const rows = computeStandings(entries, matches, config)
    const a = rows.find((r) => r.playerId === 'a')!
    expect(a.played).toBe(1)
    expect(a.gamesFor).toBe(6)
    expect(a.gamesAgainst).toBe(4)
    expect(a.diff).toBe(2)
    expect(a.wins).toBe(1)
    const c = rows.find((r) => r.playerId === 'c')!
    expect(c.diff).toBe(-2)
    expect(c.wins).toBe(0)
  })

  it('ordena por saldo, depois games a favor, depois vitórias', () => {
    const matches = [
      match('a', 'b', 'c', 'd', 6, 0, 'confirmed'),
      match('c', 'a', 'b', 'd', 6, 5, 'confirmed'),
    ]
    const rows = computeStandings(entries, matches, config)
    // a: +12/-5 = +7 ; c: +6/-6=0... calcula e confirma topo é 'a'
    expect(rows[0].playerId).toBe('a')
    expect(rows[0].diff).toBeGreaterThanOrEqual(rows[1].diff)
  })

  it('inclui todos os inscritos mesmo sem jogos', () => {
    const rows = computeStandings(entries, [], config)
    expect(rows.length).toBe(4)
    expect(rows.every((r) => r.played === 0)).toBe(true)
  })
})
