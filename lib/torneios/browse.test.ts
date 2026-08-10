import { describe, it, expect } from 'vitest'
import {
  LAST_CALL_THRESHOLD,
  filterTournaments,
  groupByPhase,
  levelFacets,
  matchesQuery,
  normalizeText,
  phaseCounts,
  phaseOf,
  priceLabel,
  sportFacets,
  spotsOf,
  summarize,
  type BrowseTournament,
} from './browse'

const TODAY = '2026-08-09'

function make(over: Partial<BrowseTournament> = {}): BrowseTournament {
  return {
    id: over.id ?? 't1',
    name: 'Torneio de Verão',
    date: '2026-08-20',
    sport: 'beach_tennis',
    status: 'open',
    level: 'B',
    category: 'livre',
    participant_type: 'dupla_fixa',
    format: 'americano',
    cover_image_url: null,
    entry_price_cents: null,
    max_players: null,
    occupiedCount: 0,
    waitlistCount: 0,
    isMine: false,
    ...over,
  }
}

describe('spotsOf', () => {
  it('sem teto declarado não inventa vaga', () => {
    const s = spotsOf({ occupiedCount: 5, max_players: null })
    expect(s.total).toBeNull()
    expect(s.remaining).toBeNull()
    expect(s.pct).toBe(0)
    expect(s.isFull).toBe(false)
    expect(s.isLastCall).toBe(false)
  })

  it('calcula restantes e percentual', () => {
    const s = spotsOf({ occupiedCount: 6, max_players: 8 })
    expect(s.remaining).toBe(2)
    expect(s.pct).toBe(75)
    expect(s.isFull).toBe(false)
    expect(s.isLastCall).toBe(true)
  })

  it('lotado zera as vagas e desliga o aviso de últimas', () => {
    const s = spotsOf({ occupiedCount: 8, max_players: 8 })
    expect(s.remaining).toBe(0)
    expect(s.pct).toBe(100)
    expect(s.isFull).toBe(true)
    expect(s.isLastCall).toBe(false)
  })

  it('estouro do teto não vira vaga negativa nem barra acima de 100', () => {
    // Acontece de verdade: admin baixa max_players com gente já inscrita.
    const s = spotsOf({ occupiedCount: 11, max_players: 8 })
    expect(s.remaining).toBe(0)
    expect(s.pct).toBe(100)
    expect(s.isFull).toBe(true)
  })

  it('acende "últimas vagas" exatamente no limiar', () => {
    expect(spotsOf({ occupiedCount: 10 - LAST_CALL_THRESHOLD, max_players: 10 }).isLastCall).toBe(true)
    expect(spotsOf({ occupiedCount: 10 - LAST_CALL_THRESHOLD - 1, max_players: 10 }).isLastCall).toBe(false)
  })
})

describe('busca', () => {
  it('normalizeText tira acento e caixa', () => {
    expect(normalizeText('  Verão MISTO ')).toBe('verao misto')
  })

  it('acha sem acento e sem caixa', () => {
    expect(matchesQuery(make(), 'verao')).toBe(true)
    expect(matchesQuery(make(), 'VERÃO')).toBe(true)
  })

  it('casa também pelo nome da modalidade', () => {
    expect(matchesQuery(make({ sport: 'padel' }), 'padel')).toBe(true)
  })

  it('exige todos os termos', () => {
    expect(matchesQuery(make(), 'verao beach')).toBe(true)
    expect(matchesQuery(make(), 'verao padel')).toBe(false)
  })

  it('termo vazio não filtra nada', () => {
    expect(matchesQuery(make(), '   ')).toBe(true)
  })
})

describe('phaseOf', () => {
  it('em andamento é ao vivo, independente da data', () => {
    expect(phaseOf({ status: 'in_progress', date: '2020-01-01' }, TODAY)).toBe('live')
  })

  it('encerrado é passado', () => {
    expect(phaseOf({ status: 'finished', date: '2030-01-01' }, TODAY)).toBe('past')
  })

  it('aberto no futuro ou hoje é aberto', () => {
    expect(phaseOf({ status: 'open', date: '2026-08-20' }, TODAY)).toBe('open')
    expect(phaseOf({ status: 'open', date: TODAY }, TODAY)).toBe('open')
  })

  it('aberto com data vencida desce para passado', () => {
    // O admin esqueceu de encerrar; não pode ocupar o topo de "inscrições abertas".
    expect(phaseOf({ status: 'open', date: '2026-08-08' }, TODAY)).toBe('past')
  })
})

describe('groupByPhase', () => {
  const items = [
    make({ id: 'antigo', status: 'finished', date: '2024-03-01' }),
    make({ id: 'proximo', status: 'open', date: '2026-08-15' }),
    make({ id: 'distante', status: 'open', date: '2026-12-01' }),
    make({ id: 'rolando', status: 'in_progress', date: '2026-08-09' }),
    make({ id: 'recente', status: 'finished', date: '2026-07-01' }),
  ]

  it('ordena as seções: ao vivo, abertas, passadas', () => {
    expect(groupByPhase(items, TODAY).map((s) => s.phase)).toEqual(['live', 'open', 'past'])
  })

  it('futuro vem do mais próximo ao mais distante', () => {
    const open = groupByPhase(items, TODAY).find((s) => s.phase === 'open')!
    expect(open.items.map((t) => t.id)).toEqual(['proximo', 'distante'])
  })

  it('passado vem do mais recente ao mais antigo', () => {
    const past = groupByPhase(items, TODAY).find((s) => s.phase === 'past')!
    expect(past.items.map((t) => t.id)).toEqual(['recente', 'antigo'])
  })

  it('encerrado antigo nunca aparece acima do torneio da semana que vem', () => {
    // Era o defeito da lista anterior: um só order('date') para todos os status.
    const flat = groupByPhase(items, TODAY).flatMap((s) => s.items.map((t) => t.id))
    expect(flat.indexOf('proximo')).toBeLessThan(flat.indexOf('antigo'))
  })

  it('não devolve seção vazia', () => {
    const only = groupByPhase([make({ status: 'open', date: '2026-09-01' })], TODAY)
    expect(only).toHaveLength(1)
    expect(only[0].phase).toBe('open')
  })

  it('empate de data desempata por nome', () => {
    const sameDay = [
      make({ id: 'b', name: 'Zeta', date: '2026-08-15' }),
      make({ id: 'a', name: 'Alfa', date: '2026-08-15' }),
    ]
    const open = groupByPhase(sameDay, TODAY).find((s) => s.phase === 'open')!
    expect(open.items.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('filterTournaments', () => {
  const items = [
    make({ id: 'bt', sport: 'beach_tennis', level: 'A' }),
    make({ id: 'padel', sport: 'padel', level: 'B', name: 'Copa Padel' }),
    make({ id: 'cross', sport: 'crossfit', level: 'B', name: 'Desafio Funcional', isMine: true }),
    make({ id: 'velho', sport: 'padel', status: 'finished', date: '2026-01-10', name: 'Copa Padel' }),
  ]

  it('filtra por modalidade', () => {
    expect(filterTournaments(items, { sport: 'padel' }, TODAY).map((t) => t.id)).toEqual([
      'padel',
      'velho',
    ])
  })

  it('filtra por nível', () => {
    expect(filterTournaments(items, { level: 'A' }, TODAY).map((t) => t.id)).toEqual(['bt'])
  })

  it('filtra por fase', () => {
    expect(filterTournaments(items, { phase: 'past' }, TODAY).map((t) => t.id)).toEqual(['velho'])
  })

  it('"meus" traz só onde o aluno está inscrito', () => {
    expect(filterTournaments(items, { phase: 'meus' }, TODAY).map((t) => t.id)).toEqual(['cross'])
  })

  it('"todos" não filtra por fase', () => {
    expect(filterTournaments(items, { phase: 'todos' }, TODAY)).toHaveLength(4)
  })

  it('combina modalidade e busca', () => {
    const out = filterTournaments(items, { sport: 'padel', q: 'copa' }, TODAY)
    expect(out.map((t) => t.id)).toEqual(['padel', 'velho'])
  })

  it('filtros vazios devolvem tudo', () => {
    expect(filterTournaments(items, {}, TODAY)).toHaveLength(4)
  })
})

describe('facetas', () => {
  const items = [
    make({ sport: 'padel', level: 'A' }),
    make({ sport: 'padel', level: 'B' }),
    make({ sport: 'beach_tennis', level: 'iniciante' }),
    make({ sport: 'crossfit', level: 'B' }),
  ]

  it('conta modalidades e ordena pela quantidade', () => {
    expect(sportFacets(items)).toEqual([
      { value: 'padel', label: 'Padel', count: 2 },
      { value: 'beach_tennis', label: 'Beach Tennis', count: 1 },
      { value: 'crossfit', label: 'CrossFit', count: 1 },
    ])
  })

  it('não cria aba para modalidade sem torneio', () => {
    expect(sportFacets(items).map((f) => f.value)).not.toContain('yoga')
  })

  it('ignora slug fora do cardápio', () => {
    expect(sportFacets([make({ sport: 'quadribol' })])).toEqual([])
  })

  it('níveis saem do mais aberto ao mais forte', () => {
    expect(levelFacets(items, 'padel').map((f) => f.value)).toEqual(['iniciante', 'B', 'A'])
  })

  it('rótulo do nível acompanha a modalidade filtrada', () => {
    expect(levelFacets(items, 'padel').map((f) => f.label)).toEqual([
      'Iniciante',
      'Nível B',
      'Nível A',
    ])
    expect(levelFacets(items, 'crossfit').map((f) => f.label)).toEqual([
      'Iniciante',
      'Avançado',
      'Elite',
    ])
  })
})

describe('phaseCounts', () => {
  it('conta cada fase e as inscrições do aluno', () => {
    const items = [
      make({ status: 'in_progress' }),
      make({ status: 'open', date: '2026-09-01', isMine: true }),
      make({ status: 'finished', date: '2026-01-01' }),
    ]
    expect(phaseCounts(items, TODAY)).toEqual({ live: 1, open: 1, past: 1, meus: 1, todos: 3 })
  })
})

describe('summarize', () => {
  it('soma as vagas só dos torneios abertos com teto', () => {
    const items = [
      make({ status: 'open', date: '2026-09-01', max_players: 8, occupiedCount: 5 }),
      make({ status: 'open', date: '2026-09-02', max_players: null, occupiedCount: 30 }),
      make({ status: 'finished', date: '2026-01-01', max_players: 8, occupiedCount: 0 }),
    ]
    const s = summarize(items, TODAY)
    expect(s.open).toBe(2)
    expect(s.openSpots).toBe(3)
    expect(s.live).toBe(0)
  })

  it('"meus" ignora torneio que já passou', () => {
    const items = [
      make({ status: 'finished', date: '2026-01-01', isMine: true }),
      make({ status: 'in_progress', isMine: true }),
    ]
    expect(summarize(items, TODAY).mine).toBe(1)
  })

  it('conta modalidades distintas', () => {
    const items = [make({ sport: 'padel' }), make({ sport: 'padel' }), make({ sport: 'yoga' })]
    expect(summarize(items, TODAY).sports).toBe(2)
  })
})

describe('priceLabel', () => {
  it('sem preço é gratuito', () => {
    expect(priceLabel(null)).toBe('Gratuito')
    expect(priceLabel(0)).toBe('Gratuito')
  })

  it('valor redondo não mostra centavos', () => {
    expect(priceLabel(4000).replace(/ /g, ' ')).toBe('R$ 40')
  })

  it('valor quebrado mostra centavos', () => {
    expect(priceLabel(3990).replace(/ /g, ' ')).toBe('R$ 39,90')
  })
})
