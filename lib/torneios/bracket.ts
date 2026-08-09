// lib/torneios/bracket.ts
// A geometria da chave de mata-mata.
//
// A chave não guarda ponteiro de "esta partida alimenta aquela": a posição já
// diz. Numerando as partidas de 1..N dentro de cada rodada, quem vence a
// partida k da rodada r ocupa um lado da partida ⌈k/2⌉ da rodada r+1 — lado
// esquerdo se k for ímpar, direito se for par. É a mesma convenção que se
// desenha no papel, e economiza uma coluna no banco que poderia divergir da
// realidade.
//
//   R1        R2       R3
//   1 ┐
//     ├─ 1 ┐
//   2 ┘    │
//          ├─ 1   (final)
//   3 ┐    │
//     ├─ 2 ┘
//   4 ┘

/** Coordenada de um lado de partida na chave. */
export interface BracketSlot {
  round: number
  matchNo: number
  /** 1 = lado esquerdo (player1), 2 = lado direito (player2). */
  slot: 1 | 2
}

/**
 * Para onde vai quem vence a partida (round, matchNo).
 * Devolve null na final — não há para onde subir.
 */
export function winnerSlot(
  round: number,
  matchNo: number,
  totalRounds: number,
): BracketSlot | null {
  if (round >= totalRounds) return null
  return {
    round: round + 1,
    matchNo: Math.ceil(matchNo / 2),
    slot: matchNo % 2 === 1 ? 1 : 2,
  }
}

/** Menor potência de 2 que comporta n participantes (mínimo 2). */
export function bracketSize(n: number): number {
  let size = 2
  while (size < n) size *= 2
  return size
}

/** Quantas rodadas tem uma chave de `size` participantes. 8 → 3. */
export function roundsForSize(size: number): number {
  return Math.max(1, Math.round(Math.log2(size)))
}

/** Quantas partidas tem a rodada r de uma chave de `size`. */
export function matchesInRound(size: number, round: number): number {
  return Math.max(1, size / 2 ** round)
}

/**
 * Nome da fase pelo que falta, não pelo que passou.
 *
 * "Rodada 3" não diz nada; "Semifinal" diz tudo. A conta é sempre a distância
 * até a final, então numa chave de 8 a rodada 2 é semifinal e numa de 32 é
 * oitavas — o mesmo número, fases diferentes.
 */
export function roundLabel(round: number, totalRounds: number): string {
  const remaining = totalRounds - round
  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semifinal'
  if (remaining === 2) return 'Quartas de final'
  if (remaining === 3) return 'Oitavas de final'
  if (remaining === 4) return '16 avos de final'
  return `${round}ª rodada`
}

/**
 * Separa quem tem cabeça-de-chave declarada de quem entra no sorteio.
 *
 * O `seed` de `tournament_entries` é opcional: a academia marca os favoritos que
 * quiser e o resto é sorteado. Os seeds saem em ordem crescente (1 primeiro),
 * porque é a posição deles na chave que garante que os dois melhores só se
 * encontrem na final. Sortear todo mundo jogaria fora essa informação.
 */
export function splitBySeed<T extends { seed: number | null }>(
  entries: T[],
): { seeded: T[]; unseeded: T[] } {
  const seeded = entries.filter((e) => e.seed !== null).sort((a, b) => a.seed! - b.seed!)
  const unseeded = entries.filter((e) => e.seed === null)
  return { seeded, unseeded }
}

/**
 * Ordem de confronto de uma chave: seed 1 contra o mais fraco, e os dois
 * primeiros só podendo se encontrar na final.
 *
 * Construção recursiva clássica: a chave de 2n é a de n intercalada com o
 * complemento. Para 8 sai [1,8,5,4,3,6,7,2] — ou seja 1×8, 5×4, 3×6, 7×2.
 * Sem isso os dois melhores podem cair na primeira rodada e o torneio perde a
 * graça na primeira hora.
 */
export function seedOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    const next: number[] = []
    for (const seed of order) {
      next.push(seed, n + 1 - seed)
    }
    order = next
  }
  return order
}
