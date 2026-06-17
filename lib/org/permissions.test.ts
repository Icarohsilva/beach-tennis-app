import { describe, it, expect } from 'vitest'
import { canAccessArea } from './permissions'

describe('canAccessArea', () => {
  it('owner can access owner-only areas', () => {
    expect(canAccessArea('financeiro', true)).toBe(true)
    expect(canAccessArea('configuracoes', true)).toBe(true)
    expect(canAccessArea('equipe', true)).toBe(true)
  })
  it('professor cannot access owner-only areas', () => {
    expect(canAccessArea('financeiro', false)).toBe(false)
    expect(canAccessArea('configuracoes', false)).toBe(false)
    expect(canAccessArea('equipe', false)).toBe(false)
  })
  it('professor can access operational areas', () => {
    expect(canAccessArea('aulas', false)).toBe(true)
    expect(canAccessArea('alunos', false)).toBe(true)
    expect(canAccessArea('dashboard', false)).toBe(true)
  })
})
