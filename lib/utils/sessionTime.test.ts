// lib/utils/sessionTime.test.ts
import { describe, it, expect } from 'vitest'
import { sessionStartIso } from './sessionTime'

describe('sessionStartIso', () => {
  it('anexa offset de Brasília (-03:00)', () => {
    expect(sessionStartIso('2026-06-11', '18:00:00')).toBe('2026-06-11T18:00:00-03:00')
  })

  it('normaliza horário HH:MM para HH:MM:SS', () => {
    expect(sessionStartIso('2026-06-11', '18:00')).toBe('2026-06-11T18:00:00-03:00')
  })

  it('representa o instante UTC correto', () => {
    // 18:00 em Brasília = 21:00 UTC
    expect(new Date(sessionStartIso('2026-06-11', '18:00:00')).getTime())
      .toBe(Date.UTC(2026, 5, 11, 21, 0, 0))
  })

  it('lança erro para formato de hora inesperado', () => {
    expect(() => sessionStartIso('2026-06-11', '8:00')).toThrow('formato de hora inesperado')
    expect(() => sessionStartIso('2026-06-11', '')).toThrow('formato de hora inesperado')
  })
})
