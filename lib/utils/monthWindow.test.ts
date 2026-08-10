import { describe, it, expect } from 'vitest'
import { getMonthWindow, getRemainingMonthWindow, getWeekWindow, shiftWindow } from './monthWindow'

// As datas dos casos são instantes UTC explícitos, não `new Date(2026, 5, 14)`.
// O construtor com componentes usa o fuso do PROCESSO, então a suíte passava por
// acidente quando rodava em UTC e mudava de resposta na máquina de quem roda em
// BRT — exatamente a confusão que este módulo existe para resolver. `T12:00:00Z`
// = 09:00 BRT, bem longe de qualquer fronteira.
describe('getMonthWindow', () => {
  it('returns first and last day of the month', () => {
    expect(getMonthWindow(new Date('2026-06-14T12:00:00Z'))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })

  it('handles February in a non-leap year', () => {
    expect(getMonthWindow(new Date('2026-02-10T12:00:00Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('handles February in a leap year', () => {
    expect(getMonthWindow(new Date('2028-02-10T12:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
  })

  // O bug que motivou a reescrita: a Vercel roda em UTC, então às 22h BRT do dia
  // 31 o relógio UTC já marcava 01/08 e a janela do aluno pulava para agosto —
  // "Check-ins do mês" zerava 3h antes da virada real.
  it('nas últimas 3h do mês em BRT a janela ainda é o mês corrente', () => {
    // 2026-08-01T01:00:00Z = 2026-07-31 22:00 BRT
    expect(getMonthWindow(new Date('2026-08-01T01:00:00Z'))).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('virou o mês em BRT: a janela acompanha', () => {
    // 2026-08-01T03:00:00Z = 2026-08-01 00:00 BRT
    expect(getMonthWindow(new Date('2026-08-01T03:00:00Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    })
  })

  it('atravessa a virada de ano em BRT', () => {
    // 2027-01-01T02:00:00Z = 2026-12-31 23:00 BRT
    expect(getMonthWindow(new Date('2027-01-01T02:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    })
  })
})

describe('getRemainingMonthWindow', () => {
  it('returns today through the last day of the month', () => {
    expect(getRemainingMonthWindow(new Date('2026-06-14T12:00:00Z'))).toEqual({
      from: '2026-06-14',
      to: '2026-06-30',
    })
  })

  it('on the first day returns the whole month', () => {
    expect(getRemainingMonthWindow(new Date('2026-06-01T12:00:00Z'))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })

  it('no último dia do mês, às 22h BRT, ainda é o mês corrente', () => {
    expect(getRemainingMonthWindow(new Date('2026-08-01T01:00:00Z'))).toEqual({
      from: '2026-07-31',
      to: '2026-07-31',
    })
  })
})

describe('getWeekWindow', () => {
  it('vai de domingo a sábado da semana da data', () => {
    // 2026-07-22 é uma quarta-feira
    expect(getWeekWindow(new Date('2026-07-22T12:00:00Z'))).toEqual({
      from: '2026-07-19',
      to: '2026-07-25',
    })
  })

  it('trata o próprio domingo como início da semana', () => {
    expect(getWeekWindow(new Date('2026-07-19T12:00:00Z'))).toEqual({
      from: '2026-07-19',
      to: '2026-07-25',
    })
  })

  it('trata o próprio sábado como fim da semana', () => {
    expect(getWeekWindow(new Date('2026-07-25T12:00:00Z'))).toEqual({
      from: '2026-07-19',
      to: '2026-07-25',
    })
  })

  it('sábado 22h BRT ainda é a semana que termina no sábado', () => {
    // 2026-07-26T01:00:00Z = sábado 2026-07-25 22:00 BRT
    expect(getWeekWindow(new Date('2026-07-26T01:00:00Z'))).toEqual({
      from: '2026-07-19',
      to: '2026-07-25',
    })
  })
})

describe('shiftWindow', () => {
  it('anda semanas para trás', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', -1)).toEqual({ from: '2026-07-12', to: '2026-07-18' })
  })

  it('anda meses para trás atravessando o ano', () => {
    const w = getMonthWindow(new Date('2026-01-15T12:00:00Z'))
    expect(shiftWindow(w, 'month', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('anda para a frente', () => {
    const w = { from: '2026-07-19', to: '2026-07-25' }
    expect(shiftWindow(w, 'week', 1)).toEqual({ from: '2026-07-26', to: '2026-08-01' })
  })

  it('recalcula o último dia do mês de destino', () => {
    // Março tem 31 dias, fevereiro de 2026 tem 28: o "to" não pode ser copiado.
    const w = { from: '2026-03-01', to: '2026-03-31' }
    expect(shiftWindow(w, 'month', -1)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('anda meses para a frente atravessando o ano', () => {
    const w = { from: '2026-11-01', to: '2026-11-30' }
    expect(shiftWindow(w, 'month', 3)).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })
})
