import { describe, it, expect } from 'vitest'
import { slugify, generateInviteCode } from './identifiers'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Arena Beach Tennis')).toBe('arena-beach-tennis')
  })
  it('removes accents', () => {
    expect(slugify('Acadêmia São João')).toBe('academia-sao-joao')
  })
  it('strips special chars and collapses hyphens', () => {
    expect(slugify('  Quadra #1 -- Top!! ')).toBe('quadra-1-top')
  })
  it('returns empty string for only-symbols input', () => {
    expect(slugify('@#$%')).toBe('')
  })
})

describe('generateInviteCode', () => {
  it('returns 8 uppercase alphanumeric chars', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^[A-Z0-9]{8}$/)
  })
  it('returns different codes across calls (high probability)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateInviteCode()))
    expect(codes.size).toBeGreaterThan(45)
  })
})
