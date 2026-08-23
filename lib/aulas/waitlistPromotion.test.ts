import { describe, it, expect } from 'vitest'
import { canAutoEnter, openSpots, AUTO_ENTRY_CUTOFF_HOURS } from './waitlistPromotion'

const START = '2026-08-25T19:00:00-03:00'

describe('canAutoEnter — corte de 1h antes do início', () => {
  it('folga confortável: promove', () => {
    expect(canAutoEnter(START, '2026-08-25T15:00:00-03:00')).toBe(true)
  })

  it('exatamente 1h antes: promove (a borda conta como dentro)', () => {
    expect(canAutoEnter(START, '2026-08-25T18:00:00-03:00')).toBe(true)
  })

  it('59 minutos antes: NÃO promove', () => {
    expect(canAutoEnter(START, '2026-08-25T18:01:00-03:00')).toBe(false)
  })

  it('aula já começada ou já passada: não promove', () => {
    expect(canAutoEnter(START, '2026-08-25T19:00:00-03:00')).toBe(false)
    expect(canAutoEnter(START, '2026-08-25T20:30:00-03:00')).toBe(false)
    expect(canAutoEnter(START, '2026-08-26T08:00:00-03:00')).toBe(false)
  })

  it('o corte é a mesma janela de arrependimento (1h)', () => {
    expect(AUTO_ENTRY_CUTOFF_HOURS).toBe(1)
  })

  it('data inválida não vira promoção', () => {
    expect(canAutoEnter('nao-e-data', '2026-08-25T15:00:00-03:00')).toBe(false)
    expect(canAutoEnter(START, 'nao-e-data')).toBe(false)
  })
})

describe('openSpots', () => {
  it('conta as vagas que sobraram', () => {
    expect(openSpots(6, 4)).toBe(2)
    expect(openSpots(6, 6)).toBe(0)
  })

  it('capacidade reduzida abaixo das reservas devolve 0, nunca negativo', () => {
    expect(openSpots(4, 6)).toBe(0)
  })
})
