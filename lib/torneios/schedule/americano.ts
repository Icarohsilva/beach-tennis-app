// lib/torneios/schedule/americano.ts
import type { RoundPlan, MatchPlan } from '../types'

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

  const rounds = circleRounds(n)
  const playCount = new Array<number>(n).fill(0)
  const plan: RoundPlan[] = []

  rounds.forEach((pairs, r) => {
    let usable = pairs
    const resting: string[] = []

    // Sobra uma dupla quando o nº de pares é ímpar (N não múltiplo de 4).
    if (pairs.length % 2 === 1) {
      // Descansa a dupla de maior carga acumulada (mantém jogos balanceados ±1).
      let restIdx = 0
      let worst = -1
      pairs.forEach((pr, i) => {
        const load = playCount[pr[0]] + playCount[pr[1]]
        if (load > worst) {
          worst = load
          restIdx = i
        }
      })
      const rp = pairs[restIdx]
      resting.push(playerIds[rp[0]], playerIds[rp[1]])
      usable = pairs.filter((_, i) => i !== restIdx)
    }

    const matches: MatchPlan[] = []
    for (let c = 0; c + 1 < usable.length; c += 2) {
      const a = usable[c]
      const b = usable[c + 1]
      matches.push({
        p1: playerIds[a[0]],
        partner1: playerIds[a[1]],
        p2: playerIds[b[0]],
        partner2: playerIds[b[1]],
      })
      playCount[a[0]]++
      playCount[a[1]]++
      playCount[b[0]]++
      playCount[b[1]]++
    }

    plan.push({ round: r + 1, matches, resting })
  })

  return plan
}
