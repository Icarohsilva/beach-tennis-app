// lib/liga/profileComplete.test.ts
import { describe, it, expect } from 'vitest'
import { isProfileComplete, missingProfileFields, type ProfileFieldsInput } from './profileComplete'

const completo: ProfileFieldsInput = {
  phone: '(11) 99999-9999',
  emergencyName: 'Maria',
  emergencyPhone: '(11) 98888-8888',
  declaredSports: ['beach_tennis'],
  orgSportsCount: 2,
}

describe('missingProfileFields', () => {
  it('cadastro completo não devolve nada', () => {
    expect(missingProfileFields(completo)).toEqual([])
    expect(isProfileComplete(completo)).toBe(true)
  })

  it('nomeia cada campo que falta', () => {
    expect(missingProfileFields({ ...completo, phone: null })).toEqual(['Telefone / WhatsApp'])
    expect(missingProfileFields({ ...completo, emergencyName: null })).toEqual([
      'Nome do contato de emergência',
    ])
    expect(missingProfileFields({ ...completo, emergencyPhone: null })).toEqual([
      'Telefone do contato de emergência',
    ])
  })

  it('espaço em branco não conta como preenchido', () => {
    expect(missingProfileFields({ ...completo, emergencyPhone: '   ' })).toEqual([
      'Telefone do contato de emergência',
    ])
  })

  it('academia com uma modalidade só não exige declarar modalidade', () => {
    const input = { ...completo, declaredSports: [], orgSportsCount: 1 }
    expect(missingProfileFields(input)).toEqual([])
    expect(isProfileComplete(input)).toBe(true)
  })

  it('com mais de uma modalidade, não declarar nenhuma bloqueia o bônus', () => {
    const input = { ...completo, declaredSports: [], orgSportsCount: 3 }
    expect(missingProfileFields(input)).toEqual(['Suas modalidades'])
  })

  it('acumula todos os pendentes, não só o primeiro', () => {
    const vazio: ProfileFieldsInput = {
      phone: null,
      emergencyName: null,
      emergencyPhone: null,
      declaredSports: [],
      orgSportsCount: 2,
    }
    expect(missingProfileFields(vazio)).toHaveLength(4)
    expect(isProfileComplete(vazio)).toBe(false)
  })
})
