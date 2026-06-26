// lib/torneios/schedule/americano.test.ts
import { describe, it, expect } from 'vitest'
import { generateAmericanoSchedule } from './americano'

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i}`)
}

const SIZES = [4, 6, 8, 10, 12, 16]

describe('generateAmericanoSchedule — invariantes por tamanho', () => {
  for (const n of SIZES) {
    it(`N=${n}: estrutura válida, jogos e byes balanceados (±1), parceria <=1`, () => {
      const plan = generateAmericanoSchedule(ids(n))
      expect(plan.length).toBe(n - 1)

      const playCount = new Map<string, number>()
      const byeCount = new Map<string, number>()
      const partnerSeen = new Map<string, number>()

      for (const round of plan) {
        // Ninguém aparece duas vezes na mesma rodada.
        const seen = new Set<string>()
        for (const m of round.matches) {
          for (const id of [m.p1, m.partner1, m.p2, m.partner2]) {
            if (id === null) continue
            expect(seen.has(id)).toBe(false)
            seen.add(id)
          }
          for (const [x, y] of [
            [m.p1, m.partner1],
            [m.p2, m.partner2],
          ] as const) {
            if (x && y) {
              const key = [x, y].sort().join('|')
              partnerSeen.set(key, (partnerSeen.get(key) ?? 0) + 1)
            }
          }
          for (const id of [m.p1, m.partner1, m.p2, m.partner2]) {
            if (id) playCount.set(id, (playCount.get(id) ?? 0) + 1)
          }
        }
        for (const id of round.resting) {
          expect(seen.has(id)).toBe(false)
          byeCount.set(id, (byeCount.get(id) ?? 0) + 1)
        }
      }

      // Todos jogaram ao menos uma vez.
      expect(playCount.size).toBe(n)
      const plays = [...playCount.values()]
      expect(Math.max(...plays) - Math.min(...plays)).toBeLessThanOrEqual(1)

      // Byes balanceados (quando há byes).
      const byes = SIZES.includes(n) ? [...byeCount.values()] : []
      if (byes.length > 0) {
        expect(Math.max(...byes) - Math.min(...byes)).toBeLessThanOrEqual(1)
      }

      // Nenhuma parceria se repete (método do círculo dá cada par no máx 1x).
      for (const c of partnerSeen.values()) expect(c).toBeLessThanOrEqual(1)
    })
  }
})

describe('generateAmericanoSchedule — N=8 caso ideal', () => {
  it('7 rodadas, 2 partidas/rodada, ninguém descansa, todos parceiros 1x', () => {
    const plan = generateAmericanoSchedule(ids(8))
    expect(plan.length).toBe(7)
    for (const r of plan) {
      expect(r.matches.length).toBe(2)
      expect(r.resting.length).toBe(0)
    }
  })
})

describe('generateAmericanoSchedule — tamanhos inválidos', () => {
  it('rejeita ímpar, <4 e >16', () => {
    expect(() => generateAmericanoSchedule(ids(5))).toThrow()
    expect(() => generateAmericanoSchedule(ids(2))).toThrow()
    expect(() => generateAmericanoSchedule(ids(18))).toThrow()
  })
})
