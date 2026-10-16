// lib/torneios/schedule/americano.test.ts
import { describe, it, expect } from 'vitest'
import { generateAmericanoSchedule } from './americano'

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i}`)
}

const SIZES = [4, 6, 8, 10, 12, 14, 16]

describe('generateAmericanoSchedule — invariantes por tamanho', () => {
  for (const n of SIZES) {
    it(`N=${n}: estrutura válida, todos jogam e descansam o MESMO número de vezes`, () => {
      const plan = generateAmericanoSchedule(ids(n))
      // Com 6, 10 ou 14 o Super ganha uma rodada: em N−1 a conta não fecha e
      // duas pessoas jogariam uma partida a mais (ver superRounds).
      expect(plan.length).toBe(n % 4 === 0 ? n - 1 : n)

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

      // A classificação soma vitórias e games: um jogo a mais é vantagem.
      expect(playCount.size).toBe(n)
      const plays = Array.from(playCount.values())
      expect(Math.max(...plays) - Math.min(...plays)).toBe(0)

      const byes = Array.from(byeCount.values())
      if (byes.length > 0) {
        expect(byeCount.size).toBe(n)
        expect(Math.max(...byes) - Math.min(...byes)).toBe(0)
      }

      // Múltiplo de 4 (círculo): cada dupla se forma no máximo 1 vez. Com 6, 10
      // ou 14 a rodada que iguala os jogos pode repetir UMA dupla — o preço de
      // ninguém jogar a mais.
      const repeated = Array.from(partnerSeen.values()).filter((c) => c > 1).length
      expect(repeated).toBeLessThanOrEqual(n % 4 === 0 ? 0 : 1)
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

describe('generateAmericanoSchedule — N=10', () => {
  it('10 rodadas de 2 jogos e todos jogam 8 (em 9 rodadas, dois jogavam 8 e oito jogavam 7)', () => {
    const plan = generateAmericanoSchedule(ids(10))
    expect(plan.length).toBe(10)
    expect(plan.every((r) => r.matches.length === 2 && r.resting.length === 2)).toBe(true)
    const plays = new Map<string, number>()
    for (const r of plan) {
      for (const m of r.matches) {
        for (const id of [m.p1, m.partner1, m.p2, m.partner2]) plays.set(id!, (plays.get(id!) ?? 0) + 1)
      }
    }
    expect(Array.from(plays.values())).toEqual(Array(10).fill(8))
  })
})

describe('generateAmericanoSchedule — tamanhos inválidos', () => {
  it('rejeita ímpar, <4 e >16', () => {
    expect(() => generateAmericanoSchedule(ids(5))).toThrow()
    expect(() => generateAmericanoSchedule(ids(2))).toThrow()
    expect(() => generateAmericanoSchedule(ids(18))).toThrow()
  })
})
