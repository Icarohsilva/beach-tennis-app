import { describe, it, expect } from 'vitest'
import {
  eventPhase,
  eventPhaseLabel,
  formatEventRange,
  lastDay,
  sortEventTournaments,
  summarizeEvent,
  type EventTournament,
} from './event'

function t(over: Partial<EventTournament> & { id: string }): EventTournament {
  return {
    name: `Torneio ${over.id}`,
    date: '2026-08-22',
    sport: 'beach_tennis',
    category: 'livre',
    level: 'B',
    participant_type: 'dupla_fixa',
    format: 'americano',
    status: 'open',
    entry_price_cents: null,
    max_players: null,
    occupiedCount: 0,
    ...over,
  }
}

describe('lastDay', () => {
  it('sem data de fim, o último dia é o de início', () => {
    expect(lastDay({ starts_on: '2026-08-22', ends_on: null })).toBe('2026-08-22')
  })

  it('com data de fim, é ela', () => {
    expect(lastDay({ starts_on: '2026-08-22', ends_on: '2026-08-24' })).toBe('2026-08-24')
  })
})

describe('eventPhase', () => {
  const evento = { starts_on: '2026-08-22', ends_on: '2026-08-24' }

  it('antes do início é "em breve"', () => {
    expect(eventPhase(evento, '2026-08-21')).toBe('upcoming')
  })

  it('depois do fim é "encerrado"', () => {
    expect(eventPhase(evento, '2026-08-25')).toBe('past')
  })

  it('durante o intervalo é "acontecendo", inclusive nas pontas', () => {
    expect(eventPhase(evento, '2026-08-22')).toBe('running')
    expect(eventPhase(evento, '2026-08-23')).toBe('running')
    expect(eventPhase(evento, '2026-08-24')).toBe('running')
  })

  it('evento de um dia acontece durante o dia inteiro', () => {
    // Comparar por instante faria o evento de sábado "encerrar" à meia-noite e um.
    const umDia = { starts_on: '2026-08-22', ends_on: null }
    expect(eventPhase(umDia, '2026-08-21')).toBe('upcoming')
    expect(eventPhase(umDia, '2026-08-22')).toBe('running')
    expect(eventPhase(umDia, '2026-08-23')).toBe('past')
  })
})

describe('eventPhaseLabel', () => {
  it('nomeia cada estado', () => {
    expect(eventPhaseLabel('upcoming')).toBe('Em breve')
    expect(eventPhaseLabel('running')).toBe('Acontecendo agora')
    expect(eventPhaseLabel('past')).toBe('Encerrado')
  })
})

describe('formatEventRange', () => {
  it('um dia sai com o dia da semana', () => {
    expect(formatEventRange({ starts_on: '2026-08-22', ends_on: null })).toBe(
      'sábado, 22 de agosto',
    )
  })

  it('fim igual ao início conta como um dia, não como intervalo', () => {
    // Senão sairia "22 a 22 de agosto".
    expect(formatEventRange({ starts_on: '2026-08-22', ends_on: '2026-08-22' })).toBe(
      'sábado, 22 de agosto',
    )
  })

  it('mesmo mês não repete o mês', () => {
    expect(formatEventRange({ starts_on: '2026-08-22', ends_on: '2026-08-24' })).toBe(
      '22 a 24 de agosto',
    )
  })

  it('meses diferentes escrevem os dois meses', () => {
    expect(formatEventRange({ starts_on: '2026-08-30', ends_on: '2026-09-01' })).toBe(
      '30 de agosto a 01 de setembro',
    )
  })

  it('anos diferentes incluem o ano nas duas pontas', () => {
    // Réveillon: sem o ano a frase fica ambígua.
    expect(formatEventRange({ starts_on: '2026-12-30', ends_on: '2027-01-02' })).toBe(
      '30 de dez de 2026 a 02 de jan de 2027',
    )
  })
})

describe('sortEventTournaments', () => {
  const items = [
    t({ id: 'encerrado', status: 'finished', date: '2026-08-22' }),
    t({ id: 'rolando', status: 'in_progress', date: '2026-08-22' }),
    t({ id: 'aberto-b', status: 'open', name: 'Feminino B', date: '2026-08-22' }),
    t({ id: 'aberto-a', status: 'open', name: 'Feminino A', date: '2026-08-22' }),
  ]

  it('inscrição aberta primeiro — é a ação da página', () => {
    expect(sortEventTournaments(items).map((x) => x.id)).toEqual([
      'aberto-a',
      'aberto-b',
      'rolando',
      'encerrado',
    ])
  })

  it('dentro da faixa, ordena por data e depois por nome', () => {
    const mesmaFaixa = [
      t({ id: 'z', name: 'Zeta', date: '2026-08-22' }),
      t({ id: 'a', name: 'Alfa', date: '2026-08-22' }),
      t({ id: 'antes', name: 'Zeta', date: '2026-08-21' }),
    ]
    expect(sortEventTournaments(mesmaFaixa).map((x) => x.id)).toEqual(['antes', 'a', 'z'])
  })

  it('não muta a lista recebida', () => {
    const original = items.map((x) => x.id)
    sortEventTournaments(items)
    expect(items.map((x) => x.id)).toEqual(original)
  })

  it('lista vazia não quebra', () => {
    expect(sortEventTournaments([])).toEqual([])
  })
})

describe('summarizeEvent', () => {
  it('conta torneios, abertos, inscritos e modalidades', () => {
    const s = summarizeEvent([
      t({ id: '1', status: 'open', occupiedCount: 8, sport: 'beach_tennis' }),
      t({ id: '2', status: 'open', occupiedCount: 12, sport: 'beach_tennis' }),
      t({ id: '3', status: 'finished', occupiedCount: 6, sport: 'padel' }),
    ])
    expect(s).toEqual({ total: 3, open: 2, entrants: 26, sports: 2 })
  })

  it('evento sem torneio vinculado é tudo zero', () => {
    expect(summarizeEvent([])).toEqual({ total: 0, open: 0, entrants: 0, sports: 0 })
  })

  it('contagem negativa não subtrai do total de inscritos', () => {
    expect(summarizeEvent([t({ id: '1', occupiedCount: -3 })]).entrants).toBe(0)
  })
})
