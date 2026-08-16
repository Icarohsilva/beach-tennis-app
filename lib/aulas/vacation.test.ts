import { describe, it, expect } from 'vitest'
import { isOnVacation, overlaps, vacationDatesInWindow } from './vacation'

const FERIAS = [{ startsOn: '2026-08-10', endsOn: '2026-08-20' }]

describe('isOnVacation', () => {
  it('data dentro do período', () => {
    expect(isOnVacation(FERIAS, '2026-08-15')).toBe(true)
  })

  // As duas bordas importam: quem marca de 10 a 20 espera não ter aula no dia
  // 10 nem no dia 20. Um `<` no lugar de `<=` gera a aula fantasma do último dia.
  it('as duas bordas são inclusivas', () => {
    expect(isOnVacation(FERIAS, '2026-08-10')).toBe(true)
    expect(isOnVacation(FERIAS, '2026-08-20')).toBe(true)
  })

  it('véspera e dia seguinte ficam de fora', () => {
    expect(isOnVacation(FERIAS, '2026-08-09')).toBe(false)
    expect(isOnVacation(FERIAS, '2026-08-21')).toBe(false)
  })

  it('sem período nenhum, nunca está de férias', () => {
    expect(isOnVacation([], '2026-08-15')).toBe(false)
  })

  it('vale para qualquer um dos períodos', () => {
    const dois = [...FERIAS, { startsOn: '2026-12-20', endsOn: '2027-01-05' }]
    expect(isOnVacation(dois, '2026-12-31')).toBe(true)
    expect(isOnVacation(dois, '2027-01-05')).toBe(true)
    expect(isOnVacation(dois, '2027-01-06')).toBe(false)
  })

  // Comparação é de string ISO, então a virada de ano não é caso especial —
  // mas é justamente onde um `new Date()` mal usado quebraria.
  it('atravessa a virada do ano', () => {
    const reveillon = [{ startsOn: '2026-12-28', endsOn: '2027-01-03' }]
    expect(isOnVacation(reveillon, '2026-12-31')).toBe(true)
    expect(isOnVacation(reveillon, '2027-01-01')).toBe(true)
  })

  it('período de um dia só', () => {
    const umDia = [{ startsOn: '2026-08-10', endsOn: '2026-08-10' }]
    expect(isOnVacation(umDia, '2026-08-10')).toBe(true)
    expect(isOnVacation(umDia, '2026-08-11')).toBe(false)
  })
})

describe('overlaps', () => {
  it('períodos que se cruzam', () => {
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-18', endsOn: '2026-08-25' })).toBe(true)
  })

  it('período contido no outro', () => {
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-12', endsOn: '2026-08-14' })).toBe(true)
  })

  it('encostar na borda conta como sobreposição', () => {
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-20', endsOn: '2026-08-30' })).toBe(true)
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-01', endsOn: '2026-08-10' })).toBe(true)
  })

  it('períodos separados não se sobrepõem', () => {
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-21', endsOn: '2026-08-30' })).toBe(false)
    expect(overlaps(FERIAS[0], { startsOn: '2026-08-01', endsOn: '2026-08-09' })).toBe(false)
  })

  it('é simétrico', () => {
    const b = { startsOn: '2026-08-18', endsOn: '2026-08-25' }
    expect(overlaps(FERIAS[0], b)).toBe(overlaps(b, FERIAS[0]))
  })
})

describe('vacationDatesInWindow', () => {
  it('recorta o período na janela pedida', () => {
    const dates = vacationDatesInWindow(FERIAS, '2026-08-18', '2026-08-24')
    expect(Array.from(dates).sort()).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ])
  })

  it('janela inteira dentro das férias devolve todos os dias', () => {
    const dates = vacationDatesInWindow(FERIAS, '2026-08-12', '2026-08-14')
    expect(dates.size).toBe(3)
  })

  it('janela fora das férias devolve conjunto vazio', () => {
    expect(vacationDatesInWindow(FERIAS, '2026-09-01', '2026-09-07').size).toBe(0)
  })

  it('soma períodos diferentes sem duplicar', () => {
    const dois = [
      { startsOn: '2026-08-10', endsOn: '2026-08-12' },
      { startsOn: '2026-08-11', endsOn: '2026-08-13' },
    ]
    const dates = vacationDatesInWindow(dois, '2026-08-01', '2026-08-31')
    expect(Array.from(dates).sort()).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
    ])
  })

  it('atravessa a virada do mês', () => {
    const dates = vacationDatesInWindow(
      [{ startsOn: '2026-08-30', endsOn: '2026-09-02' }],
      '2026-08-01',
      '2026-09-30',
    )
    expect(Array.from(dates).sort()).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })
})
