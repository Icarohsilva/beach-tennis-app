import { describe, it, expect } from 'vitest'
import { DrawRuleError, generateMixedAmericanoSchedule, mixedDrawProblem, type DrawPlayer } from './americanoMixed'

function roster(men: number, women: number): DrawPlayer[] {
  return [
    ...Array.from({ length: men }, (_, i) => ({ id: `h${i + 1}`, gender: 'M' as const })),
    ...Array.from({ length: women }, (_, i) => ({ id: `m${i + 1}`, gender: 'F' as const })),
  ]
}

function analyse(players: DrawPlayer[]) {
  const male = new Set(players.filter((p) => p.gender === 'M').map((p) => p.id))
  const plan = generateMixedAmericanoSchedule(players)
  const plays = new Map<string, number>()
  const partners = new Map<string, number>()
  let malePairs = 0
  let malesVsFemales = 0
  for (const round of plan) {
    const seen = new Set<string>()
    for (const g of round.matches) {
      const sides = [[g.p1!, g.partner1!], [g.p2!, g.partner2!]]
      for (const [a, b] of sides) {
        if (male.has(a) && male.has(b)) malePairs++
        const key = [a, b].sort().join('+')
        partners.set(key, (partners.get(key) ?? 0) + 1)
      }
      const kind = sides.map(([a, b]) => Number(male.has(a)) + Number(male.has(b)))
      if ((kind[0] === 2 && kind[1] === 0) || (kind[0] === 0 && kind[1] === 2)) malesVsFemales++
      for (const id of sides.flat()) {
        expect(seen.has(id)).toBe(false) // ninguém joga duas vezes na mesma rodada
        seen.add(id)
        plays.set(id, (plays.get(id) ?? 0) + 1)
      }
    }
    for (const id of round.resting) expect(seen.has(id)).toBe(false)
    expect(seen.size + round.resting.length).toBe(players.length)
  }
  const counts = players.map((p) => plays.get(p.id) ?? 0)
  const repeatedPartners = Array.from(partners.values()).filter((v) => v > 1).length
  return { plan, malePairs, malesVsFemales, min: Math.min(...counts), max: Math.max(...counts), repeatedPartners }
}

describe('generateMixedAmericanoSchedule', () => {
  it('3 homens e 7 mulheres: nenhuma dupla masculina, jogos equilibrados, parceiro nunca repete', () => {
    const r = analyse(roster(3, 7))
    expect(r.plan).toHaveLength(9)
    expect(r.plan.every((round) => round.matches.length === 2 && round.resting.length === 2)).toBe(true)
    expect(r.malePairs).toBe(0)
    expect(r.malesVsFemales).toBe(0)
    expect(r.max - r.min).toBeLessThanOrEqual(1)
    expect(r.repeatedPartners).toBe(0)
  })

  it('nunca forma dupla masculina, em qualquer Super misto possível de 4 a 16 jogadores', () => {
    for (let n = 4; n <= 16; n += 2) {
      for (let men = 0; men <= n; men++) {
        const players = roster(men, n - men)
        if (mixedDrawProblem(players)) continue
        const r = analyse(players)
        expect(r.malePairs, `${men}H/${n - men}M`).toBe(0)
        expect(r.malesVsFemales, `${men}H/${n - men}M`).toBe(0)
        // Com no máximo tantos homens quanto mulheres, ninguém fica 2 jogos atrás.
        if (men <= n - men) expect(r.max - r.min, `${men}H/${n - men}M`).toBeLessThanOrEqual(1)
      }
    }
  }, 60_000)

  it('mais homens do que a regra comporta: avisa em vez de gerar', () => {
    expect(() => generateMixedAmericanoSchedule(roster(7, 3))).toThrow(DrawRuleError)
    expect(mixedDrawProblem(roster(7, 3))).toContain('7 homens e 3 mulheres')
  })

  it('jogador sem gênero no cadastro: avisa', () => {
    const players = [...roster(1, 2), { id: 'x', gender: null }]
    expect(mixedDrawProblem(players)).toContain('sem gênero')
  })
})
