import { describe, it, expect } from 'vitest'
import {
  onlyDigits,
  detectDocumentType,
  isValidCPF,
  isValidCNPJ,
  isValidDocument,
  formatDocument,
} from './documento'

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725')
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181')
    expect(onlyDigits('abc')).toBe('')
  })
})

describe('detectDocumentType', () => {
  it('11 dígitos = cpf, 14 = cnpj, resto = null', () => {
    expect(detectDocumentType('52998224725')).toBe('cpf')
    expect(detectDocumentType('11222333000181')).toBe('cnpj')
    expect(detectDocumentType('123')).toBeNull()
    expect(detectDocumentType('')).toBeNull()
  })
})

describe('isValidCPF', () => {
  it('aceita CPF válido', () => {
    expect(isValidCPF('52998224725')).toBe(true)
    expect(isValidCPF('11144477735')).toBe(true)
  })
  it('rejeita dígito verificador errado', () => {
    expect(isValidCPF('52998224724')).toBe(false)
    expect(isValidCPF('12345678900')).toBe(false)
  })
  it('rejeita todos dígitos iguais e tamanho errado', () => {
    expect(isValidCPF('11111111111')).toBe(false)
    expect(isValidCPF('00000000000')).toBe(false)
    expect(isValidCPF('5299822472')).toBe(false)
  })
})

describe('isValidCNPJ', () => {
  it('aceita CNPJ válido', () => {
    expect(isValidCNPJ('11222333000181')).toBe(true)
  })
  it('rejeita dígito verificador errado', () => {
    expect(isValidCNPJ('11222333000182')).toBe(false)
    expect(isValidCNPJ('12345678000100')).toBe(false)
  })
  it('rejeita todos dígitos iguais e tamanho errado', () => {
    expect(isValidCNPJ('00000000000000')).toBe(false)
    expect(isValidCNPJ('1122233300018')).toBe(false)
  })
})

describe('isValidDocument', () => {
  it('valida CPF ou CNPJ a partir de string com máscara', () => {
    expect(isValidDocument('529.982.247-25')).toBe(true)
    expect(isValidDocument('11.222.333/0001-81')).toBe(true)
  })
  it('rejeita inválidos e tamanhos fora de 11/14', () => {
    expect(isValidDocument('529.982.247-24')).toBe(false)
    expect(isValidDocument('123')).toBe(false)
    expect(isValidDocument('')).toBe(false)
  })
})

describe('formatDocument', () => {
  it('aplica máscara de CPF', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25')
  })
  it('aplica máscara de CNPJ', () => {
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
  })
  it('mascara parcialmente enquanto digita', () => {
    expect(formatDocument('529')).toBe('529')
    expect(formatDocument('529982')).toBe('529.982')
  })
})
