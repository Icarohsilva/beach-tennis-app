// lib/torneios/formats.test.ts
import { describe, it, expect } from 'vitest'
import { FORMATS, isBracketFormat } from './formats'
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
