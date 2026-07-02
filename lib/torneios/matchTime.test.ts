import { describe, it, expect } from 'vitest'
import {
  brtLocalToIso,
  isoToBrtLocalInput,
  formatMatchDateTime,
  startOfTodayBrt,
} from './matchTime'

describe('brtLocalToIso', () => {
  it('interpreta o valor do input como horário de Brasília (-03:00)', () => {
    // 18:00 em Brasília = 21:00 UTC
    expect(brtLocalToIso('2026-07-05T18:00')).toBe('2026-07-05T21:00:00.000Z')
  })
  it('retorna null para string vazia', () => {
    expect(brtLocalToIso('')).toBeNull()
  })
  it('retorna null para valor inválido', () => {
    expect(brtLocalToIso('not-a-date')).toBeNull()
  })
})

describe('isoToBrtLocalInput', () => {
  it('converte ISO UTC para o formato do input em horário de Brasília', () => {
    // 21:00 UTC = 18:00 em Brasília
    expect(isoToBrtLocalInput('2026-07-05T21:00:00.000Z')).toBe('2026-07-05T18:00')
  })
  it('retorna string vazia para ISO inválido', () => {
    expect(isoToBrtLocalInput('not-a-date')).toBe('')
  })
})

describe('formatMatchDateTime', () => {
  it('formata em pt-BR com data e hora de Brasília', () => {
    const out = formatMatchDateTime('2026-07-05T21:00:00.000Z')
    expect(out).toContain('05/07')
    expect(out).toContain('18:00')
  })
})

describe('startOfTodayBrt', () => {
  it('retorna a meia-noite de Brasília do dia corrente em BRT', () => {
    // 2026-07-05T02:00Z = 2026-07-04 23:00 BRT -> hoje BRT = 2026-07-04
    const start = startOfTodayBrt(new Date('2026-07-05T02:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-07-04T03:00:00.000Z')
  })
})
