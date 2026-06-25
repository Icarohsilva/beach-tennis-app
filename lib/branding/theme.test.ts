// lib/branding/theme.test.ts
import { describe, it, expect } from 'vitest'
import { accentVars } from './theme'

describe('accentVars', () => {
  it('cor conhecida (violeta) → escala esperada com 500 = a cor escolhida', () => {
    const vars = accentVars('#7c3aed')
    expect(vars['--brand-500']).toBe('124 58 237') // #7c3aed
    // 10 tons presentes
    expect(Object.keys(vars)).toHaveLength(10)
    expect(vars['--brand-50']).toBeDefined()
    expect(vars['--brand-900']).toBeDefined()
  })

  it('laranja default → triplas laranja (idêntico ao :root)', () => {
    const vars = accentVars('#f97316')
    expect(vars['--brand-500']).toBe('249 115 22')  // #f97316
    expect(vars['--brand-600']).toBe('234 88 12')   // #ea580c
    expect(vars['--brand-50']).toBe('255 247 237')  // #fff7ed
  })

  it('cor inválida → cai no laranja default', () => {
    expect(accentVars('#000000')['--brand-500']).toBe('249 115 22')
    expect(accentVars('')['--brand-500']).toBe('249 115 22')
    // @ts-expect-error runtime
    expect(accentVars(null)['--brand-500']).toBe('249 115 22')
  })

  it('case-insensitive', () => {
    expect(accentVars('#7C3AED')['--brand-500']).toBe('124 58 237')
  })
})
