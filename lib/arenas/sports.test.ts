import { describe, it, expect } from 'vitest'
import { SPORTS, SPORT_BY_SLUG, normalizeSports, sanitizeCustomSport, sportLabel } from './sports'

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

describe('modalidades ampliadas', () => {
  it('inclui novas modalidades além das de areia', () => {
    expect(SPORT_BY_SLUG.get('crossfit')?.label).toBe('CrossFit')
    expect(SPORT_BY_SLUG.get('pilates')?.label).toBe('Pilates')
    expect(SPORT_BY_SLUG.get('futebol')?.label).toBe('Futebol')
  })
})

describe('sanitizeCustomSport', () => {
  it('prefixa e normaliza texto livre', () => {
    expect(sanitizeCustomSport('  Jiu Jitsu ')).toBe('custom:Jiu Jitsu')
  })
  it('rejeita vazio', () => {
    expect(sanitizeCustomSport('   ')).toBeNull()
  })
  it('limita o tamanho a 40 caracteres', () => {
    const long = 'a'.repeat(60)
    expect(sanitizeCustomSport(long)).toBe('custom:' + 'a'.repeat(40))
  })
})

describe('normalizeSports com custom', () => {
  it('mantém slugs conhecidos e entradas custom, remove inválidos', () => {
    expect(normalizeSports(['crossfit', 'custom:Jiu Jitsu', 'xadrez'])).toEqual([
      'crossfit',
      'custom:Jiu Jitsu',
    ])
  })
  it('remove duplicados custom', () => {
    expect(normalizeSports(['custom:Yoga', 'custom:Yoga'])).toEqual(['custom:Yoga'])
  })
})

describe('sportLabel', () => {
  it('resolve slug conhecido para label', () => {
    expect(sportLabel('padel')).toBe('Padel')
  })
  it('resolve custom para o texto puro', () => {
    expect(sportLabel('custom:Jiu Jitsu')).toBe('Jiu Jitsu')
  })
})
