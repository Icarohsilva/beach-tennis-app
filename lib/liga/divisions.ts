// lib/liga/divisions.ts
// Promoção e rebaixamento no fechamento da temporada (spec §Fase 1).
//
// Regra pura de propósito: não conhece Supabase nem temporada. O cron
// app/api/cron/liga-season-close busca os standings e aplica o resultado.

export type Division = 'bronze' | 'prata' | 'ouro' | 'diamante'

/** Escada, do mais baixo ao mais alto. Índice é a posição. */
export const DIVISION_ORDER: Division[] = ['bronze', 'prata', 'ouro', 'diamante']

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
 *   promoteCount + demoteCount, a promoção ganha e o rebaixamento é descartado.
 */
export function computeDivisionMoves(
  rows: StandingRow[],
  promoteCount: number,
  demoteCount: number,
): DivisionMove[] {
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
      for (const r of inDivision.slice(0, Math.max(0, promoteCount))) {
        if (r.points <= 0) continue // inatividade não promove
        promoted.add(r.studentId)
        moves.push({ studentId: r.studentId, from: division, to: up })
      }
    }

    if (down && demoteCount > 0) {
      for (const r of inDivision.slice(-demoteCount)) {
        if (promoted.has(r.studentId)) continue // já subiu; não pode descer também
        moves.push({ studentId: r.studentId, from: division, to: down })
      }
    }
  }

  return moves
}
