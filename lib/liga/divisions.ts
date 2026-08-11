// lib/liga/divisions.ts
// Promoção e rebaixamento no fechamento da temporada (spec §Fase 1).
//
// Regra pura de propósito: não conhece Supabase nem temporada. O cron
// app/api/cron/liga-season-close busca os standings e aplica o resultado.

export type Division = 'bronze' | 'prata' | 'ouro' | 'diamante'

/** Escada, do mais baixo ao mais alto. Índice é a posição. */
export const DIVISION_ORDER: Division[] = ['bronze', 'prata', 'ouro', 'diamante']

/**
 * Como o corte de baixo é contado.
 *
 * - `ultimos`: descem os N últimos. É o corte normal de uma divisão de passagem —
 *   a academia sabe quantos quer rebaixar, não quantos quer manter.
 * - `permanecem`: descem TODOS, menos os N que ficam. É a única forma de escrever
 *   "só o campeão continua na Diamante": lá o número que importa é quem fica, e
 *   contar pelos últimos daria um resultado diferente a cada tamanho de divisão.
 */
export type DemoteMode = 'ultimos' | 'permanecem'

export interface DivisionCut {
  /** Quantos sobem de divisão. Ignorado no topo da escada. */
  promote: number
  demoteMode: DemoteMode
  /** Quantos descem (`ultimos`) ou quantos permanecem (`permanecem`). */
  demote: number
}

/** O corte de cada divisão. É isto que a academia configura. */
export type DivisionCuts = Record<Division, DivisionCut>

/**
 * Escada padrão: funil, não retângulo.
 *
 * O Bronze é onde todo mundo entra, então promove muito; quanto mais alto, mais
 * apertado o gargalo. Uma academia que quer o modelo "só o campeão fica" troca o
 * corte do Diamante para `permanecem: 1` nas Configurações.
 */
export const DEFAULT_DIVISION_CUTS: DivisionCuts = {
  bronze: { promote: 10, demoteMode: 'ultimos', demote: 0 },
  prata: { promote: 5, demoteMode: 'ultimos', demote: 3 },
  ouro: { promote: 3, demoteMode: 'ultimos', demote: 3 },
  diamante: { promote: 0, demoteMode: 'ultimos', demote: 3 },
}

export interface StandingRow {
  studentId: string
  points: number
  division: Division
}

export interface DivisionMove {
  studentId: string
  from: Division
  to: Division
}

/** Quantos realmente sobem daquela divisão. O topo da escada nunca promove. */
export function promoteLimit(cuts: DivisionCuts, division: Division): number {
  const idx = DIVISION_ORDER.indexOf(division)
  if (idx === DIVISION_ORDER.length - 1) return 0
  return Math.max(0, cuts[division].promote)
}

/**
 * Primeira posição (1-based) que desce. `size + 1` significa "ninguém desce".
 *
 * No modo `permanecem` o corte é medido de cima: sobem os N, ficam os K seguintes,
 * o resto desce. Somar o `promoteLimit` é o que impede o corte de morder quem acabou
 * de ser promovido — e na divisão do topo, onde ninguém sobe, a conta vira só "os K
 * primeiros ficam", que é o que a academia escreveu.
 */
export function firstDemotedPosition(
  cuts: DivisionCuts,
  division: Division,
  size: number,
): number {
  if (DIVISION_ORDER.indexOf(division) === 0) return size + 1 // piso não rebaixa

  const cut = cuts[division]
  const n = Math.max(0, cut.demote)
  if (n <= 0) return size + 1

  if (cut.demoteMode === 'permanecem') return promoteLimit(cuts, division) + n + 1
  return Math.max(1, size - n + 1)
}

/**
 * Quem sobe e quem desce ao fim da temporada.
 *
 * Dentro de cada divisão ordena por pontos (desc), desempatando por studentId para
 * que o resultado seja estável — duas execuções do cron devem produzir a mesma lista.
 *
 * Guardas:
 * - Diamante é o teto: não promove. Bronze é o piso: não rebaixa.
 * - Aluno com 0 ponto nunca é promovido. Sem isso, uma divisão com 3 inscritos e
 *   nenhuma presença promoveria os três por inatividade.
 * - Um aluno nunca aparece duas vezes: quando a divisão tem menos gente que
 *   o corte de cima mais o de baixo, a promoção ganha e o rebaixamento é descartado.
 */
export function computeDivisionMoves(rows: StandingRow[], cuts: DivisionCuts): DivisionMove[] {
  const moves: DivisionMove[] = []

  for (const division of DIVISION_ORDER) {
    const inDivision = rows
      .filter((r) => r.division === division)
      .sort((a, b) => (b.points - a.points) || a.studentId.localeCompare(b.studentId))

    const idx = DIVISION_ORDER.indexOf(division)
    const up = DIVISION_ORDER[idx + 1]
    const down = DIVISION_ORDER[idx - 1]

    const promoted = new Set<string>()

    if (up) {
      for (const r of inDivision.slice(0, promoteLimit(cuts, division))) {
        if (r.points <= 0) continue // inatividade não promove
        promoted.add(r.studentId)
        moves.push({ studentId: r.studentId, from: division, to: up })
      }
    }

    if (down) {
      const from = firstDemotedPosition(cuts, division, inDivision.length)
      for (const r of inDivision.slice(from - 1)) {
        if (promoted.has(r.studentId)) continue // já subiu; não pode descer também
        moves.push({ studentId: r.studentId, from: division, to: down })
      }
    }
  }

  return moves
}
