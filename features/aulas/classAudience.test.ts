// features/aulas/classAudience.test.ts
import { describe, it, expect } from 'vitest'
import { audienceOf, decodeAudience } from './classAudience'

describe('audienceOf', () => {
  it('kids vence qualquer gender_restriction (ignorado)', () => {
    expect(audienceOf('kids', null)).toBe('kids')
    expect(audienceOf('kids', 'F')).toBe('kids')
  })

  it('adult sem restrição é livre', () => {
    expect(audienceOf('adult', null)).toBe('livre')
  })

  it('adult com restrição vira feminino/masculino', () => {
    expect(audienceOf('adult', 'F')).toBe('feminino')
    expect(audienceOf('adult', 'M')).toBe('masculino')
  })
})

describe('decodeAudience', () => {
  it('é o inverso exato de audienceOf, nas 4 opções', () => {
    for (const [type, gender] of [
      ['kids', null],
      ['adult', null],
      ['adult', 'F'],
      ['adult', 'M'],
    ] as const) {
      const audience = audienceOf(type, gender)
      expect(decodeAudience(audience)).toEqual({ type, gender_restriction: gender })
    }
  })
})
