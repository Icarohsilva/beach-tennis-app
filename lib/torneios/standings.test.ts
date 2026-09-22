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

/**
 * Posição na tabela. `computeStandings` devolve TODO jogador que apareceu numa
 * partida — os 'x1'/'x2' de enchimento entram junto —, então comparar posições
 * relativas é o que isola o critério sob teste.
 */
function posOf(rows: { playerId: string }[], id: string): number {
  return rows.findIndex((r) => r.playerId === id)
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

  it('vitória vale mais que goleada — o 1º critério', () => {
    // Era o defeito da ordem antiga, que começava pelo SALDO: 'c' vence duas e
    // 'a' vence uma goleando, e a tabela colocava 'a' na frente. Num Super, onde
    // todos jogam o mesmo número de partidas, ganhar tem de valer mais.
    const matches = [
      match('a', 'x1', 'c', 'x2', 5, 0, 'confirmed'), // a goleia
      match('c', 'x1', 'a', 'x2', 3, 2, 'confirmed'), // c vence apertado
      match('c', 'x2', 'a', 'x1', 3, 2, 'confirmed'), // c vence de novo
    ]
    const rows = computeStandings(
      [{ playerId: 'a', partnerId: null }, { playerId: 'c', partnerId: null }],
      matches,
      config,
    )
    const a = rows.find((r) => r.playerId === 'a')!
    const c = rows.find((r) => r.playerId === 'c')!
    expect(a.diff).toBeGreaterThan(c.diff) // 'a' tem saldo melhor
    expect(posOf(rows, 'c')).toBeLessThan(posOf(rows, 'a'))
  })

  it('empate em vitórias desempata por games GANHOS — o 2º critério', () => {
    const matches = [
      match('a', 'x1', 'b', 'x2', 3, 2, 'confirmed'), // a: 1V, 3 games
      match('b', 'x1', 'c', 'x2', 4, 1, 'confirmed'), // b: 1V, 2+4 = 6 games
    ]
    const rows = computeStandings(
      [{ playerId: 'a', partnerId: null }, { playerId: 'b', partnerId: null }],
      matches,
      config,
    )
    const a = rows.find((r) => r.playerId === 'a')!
    const b = rows.find((r) => r.playerId === 'b')!
    expect(a.wins).toBe(b.wins)
    expect(b.gamesFor).toBeGreaterThan(a.gamesFor)
    expect(posOf(rows, 'b')).toBeLessThan(posOf(rows, 'a'))
  })

  it('empate em vitórias e games vai para o confronto direto — o 3º critério', () => {
    // Os nomes são propositais: 'zeca' perde o desempate alfabético (o último
    // fallback) e ganha o confronto direto. Se a ordem saísse por outro critério
    // que não o confronto, 'ana' viria primeiro.
    // Cada partida usa jogadores de enchimento DIFERENTES de propósito: reusar
    // os mesmos fazia um deles terminar com o mesmo par (vitórias, games) do
    // par sob teste e entrar no bloco empatado, embaralhando o que se mede.
    const matches = [
      match('zeca', 'f1', 'ana', 'f2', 3, 2, 'confirmed'), // zeca bate ana
      match('zeca', 'f3', 'f4', 'f5', 2, 3, 'confirmed'), // zeca perde
      match('ana', 'f6', 'f7', 'f8', 3, 2, 'confirmed'), // ana ganha
    ]
    const es = [{ playerId: 'zeca', partnerId: null }, { playerId: 'ana', partnerId: null }]
    const rows = computeStandings(es, matches, config)
    const zeca = rows.find((r) => r.playerId === 'zeca')!
    const ana = rows.find((r) => r.playerId === 'ana')!
    expect(zeca.wins).toBe(ana.wins)
    expect(zeca.gamesFor).toBe(ana.gamesFor)
    expect(zeca.diff).toBe(ana.diff)
    expect(posOf(rows, 'zeca')).toBeLessThan(posOf(rows, 'ana'))
  })

  it('confronto direto num trio circular não trava a ordem', () => {
    // A x B, B x C, C x A: cada um ganha um. Comparador circular dentro de
    // `sort` daria classificação diferente a cada execução; a mini-tabela
    // empata os três e a ordem cai no desempate determinístico.
    const matches = [
      match('a', 'x1', 'b', 'x2', 3, 2, 'confirmed'),
      match('b', 'x1', 'c', 'x2', 3, 2, 'confirmed'),
      match('c', 'x1', 'a', 'x2', 3, 2, 'confirmed'),
    ]
    const es = [
      { playerId: 'a', partnerId: null },
      { playerId: 'b', partnerId: null },
      { playerId: 'c', partnerId: null },
    ]
    const ordem = computeStandings(es, matches, config).map((r) => r.playerId)
    expect(computeStandings(es, [...matches].reverse(), config).map((r) => r.playerId))
      .toEqual(ordem)
    // Os três continuam na tabela, empatados entre si e em alguma ordem estável.
    expect(['a', 'b', 'c'].every((id) => ordem.includes(id))).toBe(true)
  })

  it('parceiros na MESMA dupla não viram confronto direto', () => {
    // No Super os parceiros giram, e dois empatados podem nunca ter se
    // enfrentado. Contar a partida em que jogaram JUNTOS daria "vitória no
    // confronto direto" aos dois — um confronto que não existiu. Sem confronto,
    // a ordem tem de cair no desempate determinístico e não variar com a ordem
    // de chegada dos dados.
    const matches = [
      match('a', 'b', 'x1', 'x2', 3, 2, 'confirmed'), // a e b JUNTOS, venceram
      match('a', 'x1', 'x2', 'x3', 2, 3, 'confirmed'), // a perde
      match('b', 'x1', 'x2', 'x3', 2, 3, 'confirmed'), // b perde igual
    ]
    const es = [{ playerId: 'a', partnerId: null }, { playerId: 'b', partnerId: null }]
    const rows = computeStandings(es, matches, config)
    const a = rows.find((r) => r.playerId === 'a')!
    const b = rows.find((r) => r.playerId === 'b')!
    expect(a.wins).toBe(b.wins)
    expect(a.gamesFor).toBe(b.gamesFor)
    // Sem confronto entre eles, decide o desempate determinístico — e ele não
    // pode mudar com a ordem em que as partidas chegam.
    expect(posOf(rows, 'a')).toBeLessThan(posOf(rows, 'b'))
    const invertido = computeStandings(es, [...matches].reverse(), config)
    expect(posOf(invertido, 'a')).toBeLessThan(posOf(invertido, 'b'))
  })

  it('inclui todos os inscritos mesmo sem jogos', () => {
    const rows = computeStandings(entries, [], config)
    expect(rows.length).toBe(4)
    expect(rows.every((r) => r.played === 0)).toBe(true)
  })
})
