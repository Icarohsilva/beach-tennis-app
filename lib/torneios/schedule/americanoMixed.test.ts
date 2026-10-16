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
  it('2 homens e 8 mulheres: 10 rodadas, todos jogam 8 e ninguém repete parceiro', () => {
    // O caso que motivou a rodada extra: em 9 rodadas duas mulheres jogavam 8 e
    // o resto 7, e a classificação soma vitórias e games.
    const r = analyse(roster(2, 8))
    expect(r.plan).toHaveLength(10)
    expect(r.plan.every((round) => round.matches.length === 2 && round.resting.length === 2)).toBe(true)
    expect(r.malePairs).toBe(0)
    expect(r.malesVsFemales).toBe(0)
    expect([r.min, r.max]).toEqual([8, 8])
    expect(r.repeatedPartners).toBe(0)
  })

  it('3 homens e 7 mulheres: todos jogam 8; cada homem repete uma parceira, o piso da regra', () => {
    // 8 jogos sempre com mulher, e só existem 7: uma parceira se repete por homem.
    const r = analyse(roster(3, 7))
    expect(r.malePairs).toBe(0)
    expect([r.min, r.max]).toEqual([8, 8])
    expect(r.repeatedPartners).toBe(3)
  })

  it('nunca forma dupla masculina e todos jogam igual, em qualquer Super misto aceito de 4 a 16', () => {
    for (let n = 4; n <= 16; n += 2) {
      for (let men = 0; men <= n; men++) {
        const players = roster(men, n - men)
        if (mixedDrawProblem(players)) continue
        const r = analyse(players)
        expect(r.malePairs, `${men}H/${n - men}M`).toBe(0)
        expect(r.malesVsFemales, `${men}H/${n - men}M`).toBe(0)
        expect(r.max - r.min, `${men}H/${n - men}M`).toBe(0)
      }
    }
  }, 60_000)

  it('mais homens do que a regra comporta: avisa em vez de gerar', () => {
    expect(() => generateMixedAmericanoSchedule(roster(7, 3))).toThrow(DrawRuleError)
    expect(mixedDrawProblem(roster(7, 3))).toContain('7 homens e 3 mulheres')
  })

  it('homens que descansariam em toda rodada: recusa, porque as mulheres jogariam mais', () => {
    // 10 jogadores, 6 homens: só 4 homens cabem em quadra, então 2 descansam
    // sempre e as mulheres nunca — elas jogariam as 10 rodadas, eles bem menos.
    expect(() => generateMixedAmericanoSchedule(roster(6, 4))).toThrow(DrawRuleError)
    expect(mixedDrawProblem(roster(6, 4))).toContain('mesmo número de partidas')
    // Com 5 a conta ainda fecha: cada homem descansa as mesmas 2 vezes que as mulheres.
    expect(mixedDrawProblem(roster(5, 5))).toBeNull()
  })

  it('jogador sem gênero no cadastro: avisa', () => {
    const players = [...roster(1, 2), { id: 'x', gender: null }]
    expect(mixedDrawProblem(players)).toContain('sem gênero')
  })
})
