// lib/branding/palette.test.ts
import { describe, it, expect } from 'vitest'
import { ALLOWED_BRAND_COLORS, DEFAULT_BRAND_COLOR, isAllowedBrandColor } from './palette'

describe('palette', () => {
  it('tem 8 cores e o laranja como default', () => {
    expect(ALLOWED_BRAND_COLORS).toHaveLength(8)
    expect(DEFAULT_BRAND_COLOR).toBe('#f97316')
    expect(ALLOWED_BRAND_COLORS[0]).toBe('#f97316')
  })

  it('aceita cores da allowlist (case-insensitive)', () => {
    expect(isAllowedBrandColor('#7c3aed')).toBe(true)
    expect(isAllowedBrandColor('#7C3AED')).toBe(true)
    expect(isAllowedBrandColor('#f97316')).toBe(true)
  })

  it('rejeita cor arbitrária, vazia ou nula', () => {
    expect(isAllowedBrandColor('#123456')).toBe(false)
    expect(isAllowedBrandColor('')).toBe(false)
    expect(isAllowedBrandColor('red')).toBe(false)
    // @ts-expect-error teste de runtime com tipo errado
    expect(isAllowedBrandColor(null)).toBe(false)
    // @ts-expect-error teste de runtime com tipo errado
    expect(isAllowedBrandColor(undefined)).toBe(false)
  })
})
