import { describe, it, expect } from 'vitest'
import {
  kudosEarnsPoints,
  isoWeekKey,
  sanitizeKudosMessage,
  isKudosCategory,
  KUDOS_CATEGORIES,
} from './kudos'

describe('kudosEarnsPoints', () => {
  const base = { weeklyPaidCount: 0, reciprocalSameWeek: false, weeklyCap: 3 }

  it('primeiro elogio da semana pontua', () => {
    expect(kudosEarnsPoints(base)).toBe(true)
  })

  it('dentro do teto continua pontuando', () => {
    expect(kudosEarnsPoints({ ...base, weeklyPaidCount: 2 })).toBe(true)
  })

  it('no teto para de pontuar', () => {
    expect(kudosEarnsPoints({ ...base, weeklyPaidCount: 3 })).toBe(false)
  })

  it('acima do teto (dado corrompido) também não pontua', () => {
    expect(kudosEarnsPoints({ ...base, weeklyPaidCount: 9 })).toBe(false)
  })

  it('recíproco na mesma semana não pontua, mesmo com teto livre', () => {
    expect(kudosEarnsPoints({ ...base, reciprocalSameWeek: true })).toBe(false)
  })

  it('teto zero desliga a pontuação por elogio', () => {
    expect(kudosEarnsPoints({ ...base, weeklyCap: 0 })).toBe(false)
  })
})

describe('isoWeekKey', () => {
  it('usa a semana ISO com dois dígitos', () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 7, 5)))).toBe('2026-W32')
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 8)))).toBe('2026-W02')
  })

  it('segunda e domingo da mesma semana ISO dão a mesma chave', () => {
    const segunda = new Date(Date.UTC(2026, 7, 3, 12))
    const domingo = new Date(Date.UTC(2026, 7, 9, 12))
    expect(isoWeekKey(segunda)).toBe(isoWeekKey(domingo))
  })

  it('semanas seguidas dão chaves diferentes', () => {
    const domingo = new Date(Date.UTC(2026, 7, 9, 12))
    const segundaSeguinte = new Date(Date.UTC(2026, 7, 10, 12))
    expect(isoWeekKey(domingo)).not.toBe(isoWeekKey(segundaSeguinte))
  })

  it('virada de ano segue o ano ISO, não o calendário', () => {
    // 1º de janeiro de 2027 é sexta, ainda na semana 53 do ano ISO de 2026.
    expect(isoWeekKey(new Date(Date.UTC(2027, 0, 1, 12)))).toBe('2026-W53')
  })
})

describe('sanitizeKudosMessage', () => {
  it('remove espaço sobrando', () => {
    expect(sanitizeKudosMessage('  jogou   demais  ')).toBe('jogou demais')
  })

  it('recusa mensagem curta demais ou vazia', () => {
    expect(sanitizeKudosMessage('')).toBeNull()
    expect(sanitizeKudosMessage('  ')).toBeNull()
    expect(sanitizeKudosMessage('ok')).toBeNull()
  })

  it('corta no limite', () => {
    expect(sanitizeKudosMessage('a'.repeat(500))?.length).toBe(240)
  })
})

describe('isKudosCategory', () => {
  it('aceita as quatro categorias e recusa o resto', () => {
    for (const c of KUDOS_CATEGORIES) expect(isKudosCategory(c.value)).toBe(true)
    expect(isKudosCategory('qualquer')).toBe(false)
  })
})
