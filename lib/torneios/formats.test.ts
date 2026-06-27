// lib/torneios/formats.test.ts
import { describe, it, expect } from 'vitest'
import { FORMATS } from './formats'

describe('FORMATS', () => {
  it('registra americano com generate e computeStandings', () => {
    const eng = FORMATS['americano']
    expect(eng).toBeDefined()
    expect(typeof eng.generate).toBe('function')
    expect(typeof eng.computeStandings).toBe('function')
    expect(eng.label).toMatch(/americano/i)
  })

  it('americano.generate produz rodadas', () => {
    const plan = FORMATS['americano'].generate(['a', 'b', 'c', 'd'])
    expect(plan.length).toBe(3)
  })

  it('formato desconhecido é undefined', () => {
    expect(FORMATS['inexistente']).toBeUndefined()
  })
})
