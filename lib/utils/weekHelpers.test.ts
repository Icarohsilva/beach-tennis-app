// lib/utils/weekHelpers.test.ts
import { describe, it, expect } from 'vitest'
import { getWeekBounds } from './weekHelpers'

describe('getWeekBounds', () => {
  it('quarta-feira retorna segunda a domingo da mesma semana (BRT)', () => {
    // 2026-06-24 Wed 12:00 UTC = 09:00 BRT
    const { start, end } = getWeekBounds(new Date('2026-06-24T12:00:00Z'))
    // Segunda 2026-06-22 00:00 BRT = 03:00 UTC
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    // Domingo 2026-06-28 23:59:59.999 BRT = segunda 02:59:59.999 UTC
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('segunda-feira retorna a mesma semana', () => {
    // 2026-06-22 Mon 10:00 UTC = 07:00 BRT (segunda)
    const { start, end } = getWeekBounds(new Date('2026-06-22T10:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('domingo BRT retorna a semana atual (não a próxima)', () => {
    // 2026-06-28 Sun 20:00 UTC = 17:00 BRT (domingo)
    const { start, end } = getWeekBounds(new Date('2026-06-28T20:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-22T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-29T02:59:59.999Z')
  })

  it('segunda 01:00 UTC é ainda domingo BRT (semana anterior)', () => {
    // 2026-06-22 Mon 01:00 UTC = 2026-06-21 22:00 BRT (domingo da semana anterior)
    const { start, end } = getWeekBounds(new Date('2026-06-22T01:00:00Z'))
    expect(start.toISOString()).toBe('2026-06-15T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-06-22T02:59:59.999Z')
  })
})
