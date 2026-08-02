import { describe, it, expect } from 'vitest'
import {
  SPORTS,
  SPORT_BY_SLUG,
  normalizeSports,
  sanitizeCustomSport,
  sportLabel,
  sportEmoji,
  sportOptionsForOrg,
  normalizeSportsForOrg,
  normalizeSportForOrg,
} from './sports'

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

describe('sportEmoji', () => {
  it('usa o emoji do slug conhecido', () => {
    expect(sportEmoji('basquete')).toBe('🏀')
  })
  it('cai no genérico para custom e desconhecido', () => {
    expect(sportEmoji('custom:Jiu Jitsu')).toBe('🏅')
    expect(sportEmoji('xadrez')).toBe('🏅')
  })
})

describe('sportOptionsForOrg', () => {
  it('usa o cardápio da academia quando existe', () => {
    expect(sportOptionsForOrg(['padel', 'beach_tennis'])).toEqual(['padel', 'beach_tennis'])
  })
  it('inclui as modalidades custom da academia', () => {
    expect(sportOptionsForOrg(['custom:Jiu Jitsu'])).toEqual(['custom:Jiu Jitsu'])
  })
  it('cai no cardápio completo quando a academia não declarou nada', () => {
    expect(sportOptionsForOrg([])).toEqual(SPORTS.map((s) => s.slug))
    expect(sportOptionsForOrg(null)).toEqual(SPORTS.map((s) => s.slug))
  })
  it('descarta slug inválido gravado na academia', () => {
    expect(sportOptionsForOrg(['padel', 'xadrez'])).toEqual(['padel'])
  })
})

describe('normalizeSportsForOrg', () => {
  it('mantém só o que a academia oferece', () => {
    expect(normalizeSportsForOrg(['padel', 'futebol'], ['padel', 'beach_tennis'])).toEqual(['padel'])
  })
  it('deduplica', () => {
    expect(normalizeSportsForOrg(['padel', 'padel'], ['padel'])).toEqual(['padel'])
  })
  it('aceita qualquer slug válido quando a academia não declarou cardápio', () => {
    expect(normalizeSportsForOrg(['padel', 'futebol'], [])).toEqual(['padel', 'futebol'])
  })
  it('descarta slug inexistente mesmo sem cardápio', () => {
    expect(normalizeSportsForOrg(['xadrez'], [])).toEqual([])
  })
  it('aceita custom que a academia oferece e rejeita o que ela não oferece', () => {
    expect(normalizeSportsForOrg(['custom:Jiu Jitsu'], ['custom:Jiu Jitsu'])).toEqual([
      'custom:Jiu Jitsu',
    ])
    expect(normalizeSportsForOrg(['custom:Boxe'], ['custom:Jiu Jitsu'])).toEqual([])
  })
  it('trata entrada vazia/nula', () => {
    expect(normalizeSportsForOrg([], ['padel'])).toEqual([])
    expect(normalizeSportsForOrg(null, ['padel'])).toEqual([])
  })
})

describe('normalizeSportForOrg', () => {
  it('resolve um slug oferecido pela academia', () => {
    expect(normalizeSportForOrg('padel', ['padel', 'tenis'])).toBe('padel')
  })
  it('devolve null para slug fora do cardápio', () => {
    expect(normalizeSportForOrg('futebol', ['padel'])).toBeNull()
  })
  it('devolve null para vazio/nulo ("sem modalidade")', () => {
    expect(normalizeSportForOrg('', ['padel'])).toBeNull()
    expect(normalizeSportForOrg(null, ['padel'])).toBeNull()
  })
})
