// lib/torneios/schedule/roundRobin.ts
// Todos contra todos: cada inscrito enfrenta cada outro exatamente uma vez.
//
// Diferente do americano, aqui a unidade é a INSCRIÇÃO, não o jogador: em dupla
// fixa a dupla joga junta o torneio inteiro e enfrenta cada outra dupla uma vez.
// O americano embaralha parceiro a cada rodada; este não embaralha nada.
import type { EntryRef, MatchPlan, RoundPlan } from '../types'

export const MAX_ROUND_ROBIN_ENTRIES = 20

/**
 * Método do círculo: um fixo, o resto girando. Com número ímpar de inscritos
 * entra um adversário fantasma, e quem cair contra ele folga na rodada — é
 * assim que todo mundo joga o mesmo número de partidas.
 */
export function generateRoundRobinSchedule(entries: EntryRef[]): RoundPlan[] {
  const n = entries.length
  if (n < 3) throw new Error('O todos-contra-todos precisa de pelo menos 3 inscritos.')
  if (n > MAX_ROUND_ROBIN_ENTRIES) {
    throw new Error(`O todos-contra-todos aceita no máximo ${MAX_ROUND_ROBIN_ENTRIES} inscritos.`)
  }

  const isOdd = n % 2 === 1
  const size = isOdd ? n + 1 : n
  const GHOST = -1

  // Índices reais + o fantasma no fim, quando o número é ímpar.
  const rotating = Array.from({ length: size - 1 }, (_, i) => (i + 1 < n ? i + 1 : GHOST))
  const plan: RoundPlan[] = []

  for (let r = 0; r < size - 1; r++) {
    const arranged = [0, ...rotating]
    const matches: MatchPlan[] = []
    const resting: string[] = []

    for (let i = 0; i < size / 2; i++) {
      const a = arranged[i]
      const b = arranged[size - 1 - i]

      if (a === GHOST || b === GHOST) {
        const real = a === GHOST ? b : a
        const entry = entries[real]
        resting.push(entry.playerId)
        if (entry.partnerId) resting.push(entry.partnerId)
        continue
      }

      const left = entries[a]
      const right = entries[b]
      matches.push({
        p1: left.playerId,
        partner1: left.partnerId,
        p2: right.playerId,
        partner2: right.partnerId,
        matchNo: matches.length + 1,
      })
    }

    plan.push({ round: r + 1, matches, resting })
    // Gira uma posição — o fixo (índice 0) nunca sai do lugar.
    rotating.unshift(rotating.pop() as number)
  }

  return plan
}
