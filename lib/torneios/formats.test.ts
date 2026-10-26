// lib/torneios/formats.test.ts
import { describe, it, expect } from 'vitest'
import { FORMATS, isBracketFormat, standingsVisible } from './formats'
import type { EntryRef } from './types'

function solo(ids: string[]): EntryRef[] {
  return ids.map((playerId) => ({ playerId, partnerId: null }))
}

describe('FORMATS', () => {
  it('registra os três formatos com generate e computeStandings', () => {
    for (const key of ['americano', 'round_robin', 'eliminatoria']) {
      const eng = FORMATS[key]
      expect(eng, key).toBeDefined()
      expect(typeof eng.generate, key).toBe('function')
      expect(typeof eng.computeStandings, key).toBe('function')
      expect(eng.label, key).toBeTruthy()
    }
  })

  it('americano.generate produz rodadas', () => {
    const plan = FORMATS['americano'].generate(solo(['a', 'b', 'c', 'd']))
    expect(plan.length).toBe(3)
  })

  it('round_robin.generate produz rodadas', () => {
    const plan = FORMATS['round_robin'].generate(solo(['a', 'b', 'c', 'd']))
    expect(plan.length).toBe(3)
  })

  it('eliminatoria.generate produz a chave completa', () => {
    const plan = FORMATS['eliminatoria'].generate(solo(['a', 'b', 'c', 'd']))
    expect(plan.map((r) => r.matches.length)).toEqual([2, 1])
  })

  it('o americano ignora o parceiro — quem sorteia dupla é ele', () => {
    const comParceiro: EntryRef[] = [
      { playerId: 'a', partnerId: 'x' },
      { playerId: 'b', partnerId: 'y' },
      { playerId: 'c', partnerId: 'z' },
      { playerId: 'd', partnerId: 'w' },
    ]
    const plan = FORMATS['americano'].generate(comParceiro)
    const ids = plan.flatMap((r) => r.matches.flatMap((m) => [m.p1, m.partner1, m.p2, m.partner2]))
    expect(ids).not.toContain('x')
  })

  it('formato desconhecido é undefined', () => {
    expect(FORMATS['inexistente']).toBeUndefined()
  })

  it('só a eliminatória desenha chave', () => {
    expect(isBracketFormat('eliminatoria')).toBe(true)
    expect(isBracketFormat('americano')).toBe(false)
    expect(isBracketFormat('round_robin')).toBe(false)
    expect(isBracketFormat(null)).toBe(false)
  })
})

describe('standingsVisible', () => {
  it('no Super, o atleta só vê a classificação depois de encerrado', () => {
    expect(standingsVisible({ format: 'americano', status: 'in_progress', isAdmin: false })).toBe(false)
    expect(standingsVisible({ format: null, status: 'in_progress', isAdmin: false })).toBe(false)
    expect(standingsVisible({ format: 'americano', status: 'finished', isAdmin: false })).toBe(true)
  })

  it('o admin vê sempre', () => {
    expect(standingsVisible({ format: 'americano', status: 'in_progress', isAdmin: true })).toBe(true)
  })

  it('os outros formatos seguem abertos', () => {
    expect(standingsVisible({ format: 'round_robin', status: 'in_progress', isAdmin: false })).toBe(true)
    expect(standingsVisible({ format: 'grupos', status: 'in_progress', isAdmin: false })).toBe(true)
  })
})

describe('Super com noMalePairs', () => {
  it('o motor do americano passa a sortear sem dupla masculina', () => {
    const ids = ['h1', 'h2', 'h3', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
    const genders = Object.fromEntries(ids.map((id) => [id, id.startsWith('h') ? 'M' : 'F'])) as Record<string, 'M' | 'F'>
    const plan = FORMATS.americano.generate(
      ids.map((playerId) => ({ playerId, partnerId: null })),
      { noMalePairs: true, genders },
    )
    for (const round of plan) {
      for (const g of round.matches) {
        expect(genders[g.p1!] === 'M' && genders[g.partner1!] === 'M').toBe(false)
        expect(genders[g.p2!] === 'M' && genders[g.partner2!] === 'M').toBe(false)
      }
    }
  })
})

describe('Super com sameType', () => {
  it('o motor do americano passa a sortear só confrontos do mesmo tipo', () => {
    const ids = ['h1', 'h2', 'h3', 'h4', 'm1', 'm2', 'm3', 'm4']
    const genders = Object.fromEntries(ids.map((id) => [id, id.startsWith('h') ? 'M' : 'F'])) as Record<string, 'M' | 'F'>
    const men = (a: string | null, b: string | null) => Number(genders[a!] === 'M') + Number(genders[b!] === 'M')
    const plan = FORMATS.americano.generate(
      ids.map((playerId) => ({ playerId, partnerId: null })),
      { sameType: true, genders },
    )
    expect(plan).toHaveLength(7)
    for (const round of plan) {
      for (const g of round.matches) expect(men(g.p1, g.partner1)).toBe(men(g.p2, g.partner2))
    }
  })
})
