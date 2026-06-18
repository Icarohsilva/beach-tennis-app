import { describe, it, expect } from 'vitest'
import { formatCep, isCompleteCep, mapViaCep } from './cep'

describe('formatCep', () => {
  it('aplica máscara 00000-000', () => {
    expect(formatCep('01001000')).toBe('01001-000')
  })
  it('não passa de 8 dígitos', () => {
    expect(formatCep('010010001234')).toBe('01001-000')
  })
  it('remove não-dígitos', () => {
    expect(formatCep('01001-000abc')).toBe('01001-000')
  })
  it('parcial não insere hífen antes de 6 dígitos', () => {
    expect(formatCep('0100')).toBe('0100')
  })
})

describe('isCompleteCep', () => {
  it('true com 8 dígitos', () => {
    expect(isCompleteCep('01001-000')).toBe(true)
  })
  it('false com menos de 8', () => {
    expect(isCompleteCep('0100100')).toBe(false)
  })
})

describe('mapViaCep', () => {
  it('mapeia uf/localidade/bairro/logradouro', () => {
    expect(
      mapViaCep({ uf: 'SP', localidade: 'São Paulo', bairro: 'Sé', logradouro: 'Praça da Sé' }),
    ).toEqual({ state: 'SP', city: 'São Paulo', neighborhood: 'Sé', addressLine: 'Praça da Sé' })
  })
  it('campos ausentes viram string vazia', () => {
    expect(mapViaCep({})).toEqual({ state: '', city: '', neighborhood: '', addressLine: '' })
  })
})
