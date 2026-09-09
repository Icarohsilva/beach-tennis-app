import { describe, it, expect } from 'vitest'
import { buildDayUseRows, recurrenceConflict, type DayUseRecurrence } from './recurrence'

const SUNDAY: DayUseRecurrence = {
  id: 'rec-1',
  day_of_week: 0,
  start_time: '09:00',
  end_time: '12:00',
  court: 1,
  capacity: 12,
  sport: 'beach_tennis',
  kind: 'open',
  price_cents: 4000,
  notes: 'Traga o seu boné',
}

describe('buildDayUseRows', () => {
  it('gera só o dia da semana do molde dentro da janela', () => {
    // 2026-09-09 é quarta; a janela cobre 09/09..30/09 e tem 3 domingos.
    const rows = buildDayUseRows([SUNDAY], '2026-09-09', '2026-09-30')
    expect(rows.map((r) => r.date)).toEqual(['2026-09-13', '2026-09-20', '2026-09-27'])
  })

  it('copia modalidade, tipo, preço e capacidade do molde para cada data', () => {
    const [row] = buildDayUseRows([SUNDAY], '2026-09-13', '2026-09-13')
    expect(row).toEqual({
      recurrence_id: 'rec-1',
      court: 1,
      date: '2026-09-13',
      start_time: '09:00',
      end_time: '12:00',
      capacity: 12,
      sport: 'beach_tennis',
      kind: 'open',
      price_cents: 4000,
      notes: 'Traga o seu boné',
    })
  })

  it('inclui as duas pontas da janela', () => {
    const rows = buildDayUseRows([SUNDAY], '2026-09-13', '2026-09-20')
    expect(rows.map((r) => r.date)).toEqual(['2026-09-13', '2026-09-20'])
  })

  it('é determinística: duas chamadas com a mesma janela dão as mesmas linhas', () => {
    // A não-duplicação na gravação é do índice único; aqui o que se trava é
    // que a segunda passada do cron não inventa data nova.
    const a = buildDayUseRows([SUNDAY], '2026-09-09', '2026-09-30')
    const b = buildDayUseRows([SUNDAY], '2026-09-09', '2026-09-30')
    expect(b).toEqual(a)
  })

  it('cai no default quando o molde não declara tipo, modalidade nem preço', () => {
    const [row] = buildDayUseRows(
      [{ id: 'r', day_of_week: 0, start_time: '08:00', end_time: '10:00', court: 2, capacity: 8 }],
      '2026-09-13',
      '2026-09-13',
    )
    expect(row.kind).toBe('scheduled')
    expect(row.sport).toBeNull()
    expect(row.price_cents).toBeNull()
  })

  it('combina vários moldes', () => {
    const wed: DayUseRecurrence = { ...SUNDAY, id: 'rec-2', day_of_week: 3, court: 2 }
    const rows = buildDayUseRows([SUNDAY, wed], '2026-09-13', '2026-09-19')
    expect(rows.map((r) => `${r.date}#${r.court}`)).toEqual(['2026-09-13#1', '2026-09-16#2'])
  })

  it('devolve vazio sem molde e sem estourar com janela invertida', () => {
    expect(buildDayUseRows([], '2026-09-09', '2026-09-30')).toEqual([])
    // eachDayOfInterval LANÇA com start > end — um cron não pode cair por isso.
    expect(buildDayUseRows([SUNDAY], '2026-09-30', '2026-09-09')).toEqual([])
  })
})

describe('recurrenceConflict', () => {
  const base = { day_of_week: 0, court: 1, start_time: '09:00', end_time: '12:00' }

  it('acusa molde sobreposto no mesmo espaço e dia', () => {
    expect(recurrenceConflict({ ...base, start_time: '11:00', end_time: '13:00' }, [base]))
      .toBe('09:00')
  })

  it('deixa passar turno seguido (fim exclusivo)', () => {
    expect(recurrenceConflict({ ...base, start_time: '12:00', end_time: '15:00' }, [base]))
      .toBeNull()
  })

  it('não confunde espaços nem dias diferentes', () => {
    expect(recurrenceConflict({ ...base, court: 2 }, [base])).toBeNull()
    expect(recurrenceConflict({ ...base, day_of_week: 1 }, [base])).toBeNull()
  })

  it('compara HH:MM vindo do banco como HH:MM:SS', () => {
    // '12:00' < '12:00:00' é verdade por prefixo — sem normalizar, turno
    // seguido vindo do banco virava conflito.
    expect(recurrenceConflict(
      { ...base, start_time: '12:00', end_time: '15:00' },
      [{ ...base, start_time: '09:00:00', end_time: '12:00:00' }],
    )).toBeNull()
  })
})
