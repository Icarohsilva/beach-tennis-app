// lib/aulas/classGenderRule.test.ts
import { describe, it, expect } from 'vitest'
import { canEnterByGender, classGenderDenialMessage } from './classGenderRule'

describe('canEnterByGender', () => {
  it('turma livre (restriction null) aceita qualquer sexo, inclusive desconhecido', () => {
    expect(canEnterByGender('M', null)).toBe(true)
    expect(canEnterByGender('F', null)).toBe(true)
    expect(canEnterByGender(null, null)).toBe(true)
  })

  it('turma restrita aceita quem bate', () => {
    expect(canEnterByGender('F', 'F')).toBe(true)
    expect(canEnterByGender('M', 'M')).toBe(true)
  })

  it('turma restrita recusa quem não bate', () => {
    expect(canEnterByGender('M', 'F')).toBe(false)
    expect(canEnterByGender('F', 'M')).toBe(false)
  })

  it('turma restrita recusa sexo desconhecido — não entra por omissão', () => {
    expect(canEnterByGender(null, 'F')).toBe(false)
    expect(canEnterByGender(null, 'M')).toBe(false)
  })
})

describe('classGenderDenialMessage', () => {
  it('sexo conhecido e incompatível: diz qual é o público da turma', () => {
    expect(classGenderDenialMessage('F', true)).toBe(
      'Esta turma é exclusiva para o público feminino.',
    )
    expect(classGenderDenialMessage('M', true)).toBe(
      'Esta turma é exclusiva para o público masculino.',
    )
  })

  it('sexo desconhecido: manda completar o perfil, não recusa sem saída', () => {
    expect(classGenderDenialMessage('F', false)).toBe(
      'Complete seu sexo no seu perfil para entrar nesta turma.',
    )
  })
})
