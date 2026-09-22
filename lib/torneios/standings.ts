// lib/torneios/standings.ts
// A classificação e, principalmente, a ORDEM dela.
//
// Os critérios, nesta ordem: 1) vitórias, 2) games ganhos, 3) confronto direto.
//
// A ordem anterior começava pelo SALDO de games, e isso colocava acima quem
// venceu pouco e goleou nas poucas vezes — num Super, onde todos jogam o mesmo
// número de partidas, ganhar a partida tem de valer mais do que ganhá-la por
// muito. "Games ganhos" é o segundo critério (e não o saldo) porque é o que a
// academia anuncia na quadra; num formato de games fixos os dois dão a mesma
// ordem, e o saldo sobrou como último desempate determinístico.
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

  const confirmed = matches.filter((m) => m.result_status === 'confirmed')

  for (const m of confirmed) {
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

  // 1) vitórias, 2) games ganhos. O confronto direto não entra aqui: ele não é
  //    uma ordem total (A ganha de B, B de C, C de A acontece), e um comparador
  //    circular dentro de `sort` produz classificação diferente a cada execução.
  list.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.gamesFor - a.gamesFor ||
      b.diff - a.diff ||
      a.playerId.localeCompare(b.playerId),
  )

  return applyHeadToHead(list, confirmed)
}

/**
 * 3º critério: entre quem empatou em vitórias E games, decide o que aconteceu
 * quando esses jogadores se enfrentaram.
 *
 * Aplicado DEPOIS da ordenação e só dentro de cada bloco empatado — nunca como
 * comparador global. Com três ou mais empatados vira uma mini-tabela entre eles
 * (vitórias e games contados só nos confrontos do grupo), que é como o critério
 * se resolve em qualquer regulamento: olhar par a par num trio circular não tem
 * resposta.
 *
 * Quem não se enfrentou fica com 0 nos dois e cai no saldo geral, o último
 * desempate — sem isso a ordem dependeria da ordem de chegada dos dados.
 */
function applyHeadToHead(list: StandingRow[], confirmed: MatchResultInput[]): StandingRow[] {
  const out: StandingRow[] = []
  let i = 0

  while (i < list.length) {
    let j = i + 1
    while (
      j < list.length
      && list[j].wins === list[i].wins
      && list[j].gamesFor === list[i].gamesFor
    ) j++

    const block = list.slice(i, j)
    out.push(...(block.length > 1 ? orderByMiniLeague(block, confirmed) : block))
    i = j
  }

  return out
}

function orderByMiniLeague(block: StandingRow[], confirmed: MatchResultInput[]): StandingRow[] {
  const ids = new Set(block.map((r) => r.playerId))
  const h2h = new Map<string, { wins: number; games: number }>()
  for (const r of block) h2h.set(r.playerId, { wins: 0, games: 0 })

  for (const m of confirmed) {
    const side1 = [m.player1_id, m.partner1_id].filter((x): x is string => !!x && ids.has(x))
    const side2 = [m.player2_id, m.partner2_id].filter((x): x is string => !!x && ids.has(x))
    // Só conta quando há empatado dos DOIS lados: no Super os parceiros giram, e
    // dois deles na mesma dupla não se enfrentaram — foram sorteados juntos.
    if (side1.length === 0 || side2.length === 0) continue

    for (const id of side1) {
      const e = h2h.get(id)!
      e.games += m.games1
      if (m.games1 > m.games2) e.wins++
    }
    for (const id of side2) {
      const e = h2h.get(id)!
      e.games += m.games2
      if (m.games2 > m.games1) e.wins++
    }
  }

  return [...block].sort((a, b) => {
    const ha = h2h.get(a.playerId)!
    const hb = h2h.get(b.playerId)!
    return (
      hb.wins - ha.wins ||
      hb.games - ha.games ||
      b.diff - a.diff ||
      a.playerId.localeCompare(b.playerId)
    )
  })
}
