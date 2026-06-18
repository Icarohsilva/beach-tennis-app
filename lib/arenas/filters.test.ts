import { describe, it, expect } from 'vitest'
import { buildDirectoryFilter } from './filters'

describe('buildDirectoryFilter', () => {
  it('returns empty filter with no params', () => {
    expect(buildDirectoryFilter({})).toEqual({})
  })

  it('keeps a trimmed city', () => {
    expect(buildDirectoryFilter({ cidade: 'São Paulo' })).toEqual({ city: 'São Paulo' })
  })

  it('ignores blank city', () => {
    expect(buildDirectoryFilter({ cidade: '   ' })).toEqual({})
  })

  it('keeps a valid sport', () => {
    expect(buildDirectoryFilter({ cidade: 'Recife', esporte: 'padel' })).toEqual({
      city: 'Recife',
      sport: 'padel',
    })
  })

  it('drops an invalid sport', () => {
    expect(buildDirectoryFilter({ esporte: 'xadrez' })).toEqual({})
  })
})
