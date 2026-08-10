import { describe, it, expect } from 'vitest'
import type { EntryRef } from '../types'
import { MAX_ROUND_ROBIN_ENTRIES, generateRoundRobinSchedule } from './roundRobin'

function solo(n: number): EntryRef[] {
  return Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, partnerId: null }))
}

/** Chave "menor-maior" de um confronto, para conferir unicidade. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

describe('generateRoundRobinSchedule', () => {
  it('recusa gente de menos e gente demais', () => {
    expect(() => generateRoundRobinSchedule(solo(2))).toThrow(/pelo menos 3/)
    expect(() => generateRoundRobinSchedule(solo(MAX_ROUND_ROBIN_ENTRIES + 1))).toThrow(/no máximo/)
  })

  it('com número par: n-1 rodadas e ninguém folga', () => {
    const plan = generateRoundRobinSchedule(solo(6))
    expect(plan).toHaveLength(5)
    expect(plan.every((r) => r.matches.length === 3)).toBe(true)
    expect(plan.every((r) => r.resting.length === 0)).toBe(true)
  })

  it('com número ímpar: n rodadas e um folga por rodada', () => {
    const plan = generateRoundRobinSchedule(solo(5))
    expect(plan).toHaveLength(5)
    expect(plan.every((r) => r.matches.length === 2)).toBe(true)
    expect(plan.every((r) => r.resting.length === 1)).toBe(true)
  })

  it('cada par se enfrenta exatamente uma vez', () => {
    for (const n of [3, 4, 5, 8, 11]) {
      const plan = generateRoundRobinSchedule(solo(n))
      const seen = new Map<string, number>()
      for (const round of plan) {
        for (const m of round.matches) {
          const key = pairKey(m.p1!, m.p2!)
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
      }
      const expected = (n * (n - 1)) / 2
      expect(seen.size, `${n} inscritos`).toBe(expected)
      expect(Array.from(seen.values()).every((c) => c === 1), `${n} inscritos`).toBe(true)
    }
  })

  it('ninguém joga duas vezes na mesma rodada', () => {
    for (const n of [4, 7, 10]) {
      for (const round of generateRoundRobinSchedule(solo(n))) {
        const ids = round.matches.flatMap((m) => [m.p1, m.p2])
        expect(new Set(ids).size, `${n} inscritos, rodada ${round.round}`).toBe(ids.length)
      }
    }
  })

  it('todos jogam o mesmo número de partidas', () => {
    for (const n of [4, 5, 9]) {
      const count = new Map<string, number>()
      for (const round of generateRoundRobinSchedule(solo(n))) {
        for (const m of round.matches) {
          count.set(m.p1!, (count.get(m.p1!) ?? 0) + 1)
          count.set(m.p2!, (count.get(m.p2!) ?? 0) + 1)
        }
      }
      expect(count.size, `${n} inscritos`).toBe(n)
      const jogos = Array.from(count.values())
      expect(new Set(jogos).size, `${n} inscritos`).toBe(1)
      expect(jogos[0]).toBe(n - 1)
    }
  })

  it('cada um folga no máximo uma vez', () => {
    const folgas = new Map<string, number>()
    for (const round of generateRoundRobinSchedule(solo(7))) {
      for (const id of round.resting) folgas.set(id, (folgas.get(id) ?? 0) + 1)
    }
    expect(Array.from(folgas.values()).every((c) => c === 1)).toBe(true)
    expect(folgas.size).toBe(7)
  })

  it('a dupla fixa joga junta e folga junta', () => {
    const duos: EntryRef[] = [
      { playerId: 'a1', partnerId: 'b1' },
      { playerId: 'a2', partnerId: 'b2' },
      { playerId: 'a3', partnerId: 'b3' },
    ]
    const plan = generateRoundRobinSchedule(duos)
    for (const round of plan) {
      for (const m of round.matches) {
        // O parceiro acompanha o titular — é a mesma dupla o torneio inteiro.
        expect(m.partner1).toBe(m.p1!.replace('a', 'b'))
        expect(m.partner2).toBe(m.p2!.replace('a', 'b'))
      }
      // Ímpar (3 duplas): quem folga leva o parceiro junto.
      expect(round.resting).toHaveLength(2)
      expect(round.resting[1]).toBe(round.resting[0].replace('a', 'b'))
    }
  })

  it('numera as partidas dentro da rodada', () => {
    const plan = generateRoundRobinSchedule(solo(6))
    expect(plan[0].matches.map((m) => m.matchNo)).toEqual([1, 2, 3])
  })
})
