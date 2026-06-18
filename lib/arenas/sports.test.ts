import { describe, it, expect } from 'vitest'
import { SPORTS, SPORT_BY_SLUG, normalizeSports } from './sports'

describe('SPORTS', () => {
  it('has unique slugs', () => {
    const slugs = SPORTS.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('SPORT_BY_SLUG resolves a known sport', () => {
    expect(SPORT_BY_SLUG.get('beach_tennis')?.label).toBe('Beach Tennis')
    expect(SPORT_BY_SLUG.get('inexistente')).toBeUndefined()
  })
})

describe('normalizeSports', () => {
  it('keeps valid slugs', () => {
    expect(normalizeSports(['beach_tennis', 'padel'])).toEqual(['beach_tennis', 'padel'])
  })

  it('drops invalid slugs', () => {
    expect(normalizeSports(['beach_tennis', 'xadrez'])).toEqual(['beach_tennis'])
  })

  it('deduplicates', () => {
    expect(normalizeSports(['padel', 'padel'])).toEqual(['padel'])
  })

  it('trims whitespace before validating', () => {
    expect(normalizeSports([' padel '])).toEqual(['padel'])
  })

  it('returns empty array for empty input', () => {
    expect(normalizeSports([])).toEqual([])
  })
})
