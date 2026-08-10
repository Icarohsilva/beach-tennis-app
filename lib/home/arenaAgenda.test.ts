import { describe, it, expect } from 'vitest'
import {
  addDays,
  buildMonthGrid,
  countByKind,
  dayOfWeek,
  daysInMonth,
  gridBounds,
  groupByDate,
  monthOf,
  shiftMonth,
  sortArenaEvents,
  type ArenaEvent,
} from './arenaAgenda'

function ev(over: Partial<ArenaEvent> & { id: string }): ArenaEvent {
  return {
    kind: 'aula',
    date: '2026-08-10',
    start: '08:00:00',
    end: '09:00:00',
    title: `Item ${over.id}`,
    subtitle: null,
    sport: null,
    mine: false,
    href: null,
    booked: null,
    capacity: null,
    ...over,
  }
}

describe('sortArenaEvents', () => {
  it('ordena por dia e depois por hora', () => {
    const out = sortArenaEvents([
      ev({ id: 'c', date: '2026-08-11', start: '07:00:00' }),
      ev({ id: 'b', date: '2026-08-10', start: '19:00:00' }),
      ev({ id: 'a', date: '2026-08-10', start: '07:00:00' }),
    ])
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('item sem hora vai para o fim do dia, não para o começo', () => {
    // Um torneio marcado só por data não pode empurrar a aula das 7h para baixo.
    const out = sortArenaEvents([
      ev({ id: 'torneio', kind: 'torneio', start: null, end: null }),
      ev({ id: 'aula', start: '07:00:00' }),
    ])
    expect(out.map((e) => e.id)).toEqual(['aula', 'torneio'])
  })

  it('mesma hora: aula antes de day use, day use antes de torneio', () => {
    const out = sortArenaEvents([
      ev({ id: 't', kind: 'torneio' }),
      ev({ id: 'd', kind: 'dayuse' }),
      ev({ id: 'a', kind: 'aula' }),
    ])
    expect(out.map((e) => e.id)).toEqual(['a', 'd', 't'])
  })

  it('desempata por nome, em pt-BR', () => {
    const out = sortArenaEvents([
      ev({ id: '2', title: 'Ávila' }),
      ev({ id: '1', title: 'Amanda' }),
    ])
    expect(out.map((e) => e.id)).toEqual(['1', '2'])
  })

  it('não muta a lista recebida', () => {
    const items = [ev({ id: 'b', start: '19:00:00' }), ev({ id: 'a', start: '07:00:00' })]
    sortArenaEvents(items)
    expect(items.map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('groupByDate', () => {
  it('agrupa e ordena dentro de cada dia', () => {
    const map = groupByDate([
      ev({ id: 'tarde', date: '2026-08-10', start: '19:00:00' }),
      ev({ id: 'manha', date: '2026-08-10', start: '07:00:00' }),
      ev({ id: 'outro', date: '2026-08-12' }),
    ])
    expect(map.get('2026-08-10')?.map((e) => e.id)).toEqual(['manha', 'tarde'])
    expect(map.get('2026-08-12')?.map((e) => e.id)).toEqual(['outro'])
    expect(map.get('2026-08-11')).toBeUndefined()
  })

  it('lista vazia devolve mapa vazio', () => {
    expect(groupByDate([]).size).toBe(0)
  })
})

describe('countByKind', () => {
  it('conta por tipo e quantos são do aluno', () => {
    expect(
      countByKind([
        ev({ id: '1', kind: 'aula', mine: true }),
        ev({ id: '2', kind: 'aula' }),
        ev({ id: '3', kind: 'torneio', mine: true }),
        ev({ id: '4', kind: 'dayuse' }),
      ]),
    ).toEqual({ aula: 2, torneio: 1, dayuse: 1, mine: 2 })
  })

  it('dia vazio é tudo zero', () => {
    expect(countByKind([])).toEqual({ aula: 0, torneio: 0, dayuse: 0, mine: 0 })
  })
})

describe('addDays', () => {
  it('atravessa a virada do mês', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('atravessa a virada do ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('acerta 29 de fevereiro em ano bissexto', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
  })
})

describe('dayOfWeek', () => {
  it('domingo é 0', () => {
    // 2026-08-09 é um domingo.
    expect(dayOfWeek('2026-08-09')).toBe(0)
    expect(dayOfWeek('2026-08-10')).toBe(1)
    expect(dayOfWeek('2026-08-15')).toBe(6)
  })
})

describe('shiftMonth', () => {
  it('avança e volta dentro do ano', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09')
    expect(shiftMonth('2026-08', -1)).toBe('2026-07')
  })

  it('atravessa a virada do ano nos dois sentidos', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('salto de vários meses não passa por dia inválido', () => {
    // Somar mês em cima de "31 de março" é onde a aritmética ingênua quebra.
    expect(shiftMonth('2026-03', 11)).toBe('2027-02')
    expect(shiftMonth('2026-03', -14)).toBe('2025-01')
  })
})

describe('daysInMonth', () => {
  it('conhece os meses de 30, 31 e 28', () => {
    expect(daysInMonth('2026-08')).toBe(31)
    expect(daysInMonth('2026-09')).toBe(30)
    expect(daysInMonth('2026-02')).toBe(28)
  })

  it('acerta fevereiro bissexto', () => {
    expect(daysInMonth('2028-02')).toBe(29)
  })
})

describe('buildMonthGrid', () => {
  it('começa no domingo e termina no sábado', () => {
    const grid = buildMonthGrid('2026-08', '2026-08-10')
    for (const week of grid) {
      expect(week).toHaveLength(7)
      expect(dayOfWeek(week[0].date)).toBe(0)
      expect(dayOfWeek(week[6].date)).toBe(6)
    }
  })

  it('cobre o mês inteiro sem buraco nem repetição', () => {
    const flat = buildMonthGrid('2026-08', '').flat()
    const doMes = flat.filter((c) => c.inMonth).map((c) => c.date)
    expect(doMes).toHaveLength(31)
    expect(doMes[0]).toBe('2026-08-01')
    expect(doMes[30]).toBe('2026-08-31')
    expect(new Set(flat.map((c) => c.date)).size).toBe(flat.length)
  })

  it('as bordas trazem o mês vizinho em vez de célula vazia', () => {
    // 2026-08-01 é sábado: a primeira semana tem 6 dias de julho.
    const grid = buildMonthGrid('2026-08', '')
    expect(grid[0][0].date).toBe('2026-07-26')
    expect(grid[0][0].inMonth).toBe(false)
    expect(grid[0][6].date).toBe('2026-08-01')
    expect(grid[0][6].inMonth).toBe(true)
  })

  it('marca o dia de hoje uma única vez', () => {
    const flat = buildMonthGrid('2026-08', '2026-08-10').flat()
    expect(flat.filter((c) => c.isToday).map((c) => c.date)).toEqual(['2026-08-10'])
  })

  it('hoje fora do mês exibido não marca nada', () => {
    const flat = buildMonthGrid('2026-10', '2026-08-10').flat()
    expect(flat.some((c) => c.isToday)).toBe(false)
  })

  it('não gera semana sobrando quando o mês fecha certinho', () => {
    // 2026-02 começa num domingo e tem 28 dias: exatamente 4 semanas.
    const grid = buildMonthGrid('2026-02', '')
    expect(grid).toHaveLength(4)
    expect(grid[0][0].date).toBe('2026-02-01')
    expect(grid[3][6].date).toBe('2026-02-28')
  })
})

describe('gridBounds', () => {
  it('devolve a janela que a grade exibe, não só o mês', () => {
    // Buscar só 01→31 deixaria as bordas do calendário sem dado nenhum.
    expect(gridBounds('2026-08')).toEqual({ from: '2026-07-26', to: '2026-09-05' })
  })
})

describe('monthOf', () => {
  it('recorta o mês da data', () => {
    expect(monthOf('2026-08-10')).toBe('2026-08')
  })
})
