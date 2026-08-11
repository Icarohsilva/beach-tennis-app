// lib/aulas/ageGroup.test.ts
import { describe, it, expect } from 'vitest'
import { ageGroupMatchesClass, ageGroupWarning } from './ageGroup'

describe('ageGroupMatchesClass', () => {
  it('bate quando aluno e turma são do mesmo tipo', () => {
    expect(ageGroupMatchesClass('kids', 'kids')).toBe(true)
    expect(ageGroupMatchesClass('adult', 'adult')).toBe(true)
  })

  it('não bate quando são diferentes', () => {
    expect(ageGroupMatchesClass('kids', 'adult')).toBe(false)
    expect(ageGroupMatchesClass('adult', 'kids')).toBe(false)
  })
})

describe('ageGroupWarning', () => {
  it('não avisa quando bate', () => {
    expect(ageGroupWarning('kids', 'kids')).toBeNull()
    expect(ageGroupWarning('adult', 'adult')).toBeNull()
  })

  it('diz qual lado está desencontrado', () => {
    expect(ageGroupWarning('kids', 'adult')).toBe('Aluno kids numa turma de adulto')
    expect(ageGroupWarning('adult', 'kids')).toBe('Aluno adulto numa turma kids')
  })
})
