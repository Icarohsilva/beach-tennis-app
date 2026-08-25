// lib/torneios/content.test.ts
import { describe, it, expect } from 'vitest'
import { presentOrNull, resolveTournamentContent, type ContentSources } from './content'

const EVENT = { name: 'Copa de Agosto', slug: 'copa-de-agosto', description: 'Evento anual', rules: 'Regra do evento', venue: 'Arena Central' }

function sources(overrides: Partial<ContentSources['tournament']> = {}, event: ContentSources['event'] | null = EVENT): ContentSources {
  return {
    tournament: { description: null, rules: null, venue: null, ...overrides },
    event,
  }
}

describe('presentOrNull', () => {
  it('string com conteúdo passa direto (trimmed)', () => {
    expect(presentOrNull('  Olá  ')).toBe('Olá')
  })

  it('vazio, espaços e nulo/undefined contam como ausente', () => {
    expect(presentOrNull('')).toBeNull()
    expect(presentOrNull('   ')).toBeNull()
    expect(presentOrNull(null)).toBeNull()
    expect(presentOrNull(undefined)).toBeNull()
  })
})

describe('resolveTournamentContent', () => {
  it('texto do torneio vence o do evento', () => {
    const r = resolveTournamentContent(sources({ rules: 'Regra própria' }))
    expect(r.rules).toEqual({ text: 'Regra própria', origin: 'tournament', sourceName: null, sourceSlug: null })
  })

  it("'' e '   ' no torneio NÃO vencem o do evento — o bug do textarea limpo", () => {
    const vazio = resolveTournamentContent(sources({ rules: '' }))
    const espacos = resolveTournamentContent(sources({ rules: '   ' }))
    expect(vazio.rules?.origin).toBe('event')
    expect(espacos.rules?.origin).toBe('event')
  })

  it('sem texto próprio, herda do evento com origem e nome/slug', () => {
    const r = resolveTournamentContent(sources())
    expect(r.rules).toEqual({
      text: 'Regra do evento',
      origin: 'event',
      sourceName: 'Copa de Agosto',
      sourceSlug: 'copa-de-agosto',
    })
    expect(r.description?.origin).toBe('event')
    expect(r.venue).toEqual({ text: 'Arena Central', origin: 'event', sourceName: 'Copa de Agosto', sourceSlug: 'copa-de-agosto' })
  })

  it('torneio avulso (sem evento) nunca herda e não estoura', () => {
    const r = resolveTournamentContent(sources({}, null))
    expect(r.description).toBeNull()
    expect(r.rules).toBeNull()
    expect(r.venue).toBeNull()
  })

  it('sem texto em nenhum dos dois lados, devolve null (a UI não renderiza bloco vazio)', () => {
    const r = resolveTournamentContent(
      sources({}, { name: 'Evento vazio', slug: 'evento-vazio', description: null, rules: null, venue: null }),
    )
    expect(r.description).toBeNull()
    expect(r.rules).toBeNull()
    expect(r.venue).toBeNull()
  })

  it('cada campo herda independentemente — regulamento próprio não impede herdar a premiação/local', () => {
    const r = resolveTournamentContent(sources({ rules: 'Regra própria' }))
    expect(r.rules?.origin).toBe('tournament')
    expect(r.venue?.origin).toBe('event')
    expect(r.description?.origin).toBe('event')
  })
})
