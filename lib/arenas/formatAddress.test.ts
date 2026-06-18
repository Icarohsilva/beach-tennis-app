import { describe, it, expect } from 'vitest'
import { formatAddress } from './formatAddress'

describe('formatAddress', () => {
  it('rua + número', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '123', no_number: false })).toBe('Rua X, 123')
  })
  it('sem número → s/n', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: null, no_number: true })).toBe('Rua X, s/n')
  })
  it('sem número e sem flag → só a rua', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '', no_number: false })).toBe('Rua X')
  })
  it('sem rua → string vazia', () => {
    expect(formatAddress({ address_line: null, address_number: '123', no_number: false })).toBe('')
  })
  it('no_number tem prioridade sobre número preenchido', () => {
    expect(formatAddress({ address_line: 'Rua X', address_number: '123', no_number: true })).toBe('Rua X, s/n')
  })
})
