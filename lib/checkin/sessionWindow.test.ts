import { describe, it, expect } from 'vitest'
import { findSessionInWindow } from './sessionWindow'
import { sessionStartIso } from '@/lib/utils/sessionTime'

// Aula às 19:00 de Brasília = 22:00 UTC.
const aula19 = { id: 'a19', startsAt: sessionStartIso('2026-07-16', '19:00:00') }
const aula20 = { id: 'a20', startsAt: sessionStartIso('2026-07-16', '20:00:00') }

describe('findSessionInWindow', () => {
  it('casa no horário exato da aula', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T22:00:00Z')).toBe('a19')
  })

  it('casa 1h antes (borda inclusiva)', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T21:00:00Z')).toBe('a19')
  })

  it('casa 1h depois (borda inclusiva)', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T23:00:00Z')).toBe('a19')
  })

  it('não casa 1h01 antes', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T20:59:00Z')).toBeNull()
  })

  it('não casa 1h01 depois', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T23:01:00Z')).toBeNull()
  })

  it('janelas sobrepostas: vence a sessão mais próxima', () => {
    // 22:40Z = 19:40 BRT. Dista 40min da de 19h e 20min da de 20h.
    expect(findSessionInWindow([aula19, aula20], '2026-07-16T22:40:00Z')).toBe('a20')
  })

  it('janelas sobrepostas: ordem da lista não afeta o resultado', () => {
    expect(findSessionInWindow([aula20, aula19], '2026-07-16T22:40:00Z')).toBe('a20')
  })

  it('empate exato escolhe a primeira da lista (determinístico)', () => {
    // 22:30Z = 19:30 BRT, exatamente entre as duas.
    expect(findSessionInWindow([aula19, aula20], '2026-07-16T22:30:00Z')).toBe('a19')
  })

  it('lista vazia devolve null', () => {
    expect(findSessionInWindow([], '2026-07-16T22:00:00Z')).toBeNull()
  })

  it('janela é configurável', () => {
    expect(findSessionInWindow([aula19], '2026-07-16T20:00:00Z', 2)).toBe('a19')
  })

  it('check-in em UTC não casa aula deslocada por fuso (regressão de 3h)', () => {
    // 19:00Z = 16:00 BRT. Se alguém tratar start_time como UTC, isto casaria.
    expect(findSessionInWindow([aula19], '2026-07-16T19:00:00Z')).toBeNull()
  })
})
