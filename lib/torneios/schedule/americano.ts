// lib/torneios/schedule/americano.ts
import type { RoundPlan, MatchPlan } from '../types'
import { generateBalancedAmericanoSchedule } from './americanoMixed'

// Método do círculo: p/ m par, m-1 rodadas; cada par não-ordenado se forma 1x.
// Retorna rodadas de pares de ÍNDICES (0..m-1).
function circleRounds(m: number): [number, number][][] {
  const fixed = 0
  const rot = Array.from({ length: m - 1 }, (_, i) => i + 1)
  const rounds: [number, number][][] = []
  for (let r = 0; r < m - 1; r++) {
    const arr = [fixed, ...rot]
    const pairs: [number, number][] = []
    for (let i = 0; i < m / 2; i++) {
      pairs.push([arr[i], arr[m - 1 - i]])
    }
    rounds.push(pairs)
    // Rotaciona rot uma posição (circle method).
    rot.unshift(rot.pop() as number)
  }
  return rounds
}

export function generateAmericanoSchedule(playerIds: string[]): RoundPlan[] {
  const n = playerIds.length
  if (n < 4 || n > 16 || n % 2 !== 0) {
    throw new Error('Super aceita apenas um número par de 4 a 16 jogadores.')
  }

  // Com 6, 10 ou 14 sobra uma dupla de fora por rodada, e nas N−1 rodadas do
  // círculo duas pessoas jogavam uma partida a mais que as outras. A busca
  // monta as N rodadas em que todo mundo joga o mesmo número (superRounds).
  if (n % 4 !== 0) return generateBalancedAmericanoSchedule(playerIds)

  // Múltiplo de 4: todas as duplas da rodada jogam, ninguém descansa.
  return circleRounds(n).map((pairs, r) => {
    const matches: MatchPlan[] = []
    for (let c = 0; c + 1 < pairs.length; c += 2) {
      const a = pairs[c]
      const b = pairs[c + 1]
      matches.push({
        p1: playerIds[a[0]],
        partner1: playerIds[a[1]],
        p2: playerIds[b[0]],
        partner2: playerIds[b[1]],
      })
    }
    return { round: r + 1, matches, resting: [] }
  })
}
