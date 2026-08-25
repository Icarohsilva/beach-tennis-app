// lib/torneios/content.ts
// Herança de conteúdo torneio → evento (migração 20260826000500).
//
// Uma "Copa de Agosto" tem 6 categorias que dividem UM regulamento e UM
// local. Regulamento copiado seis vezes diverge na primeira correção de
// digitação — por isso o torneio herda do evento quando o campo próprio
// está vazio. A UI é OBRIGADA a mostrar a origem (nunca fingir que texto
// herdado é próprio): por isso a função devolve origem e nome/slug da fonte,
// não só o texto.
export type ContentOrigin = 'tournament' | 'event'

export interface ResolvedText {
  text: string
  origin: ContentOrigin
  /** Nome do evento, só quando origin === 'event'. */
  sourceName: string | null
  /** Slug do evento, para linkar de volta — só quando origin === 'event'. */
  sourceSlug: string | null
}

export interface ContentSources {
  tournament: {
    description: string | null
    rules: string | null
    venue: string | null
  }
  event: {
    name: string
    slug: string
    description: string | null
    rules: string | null
    venue: string | null
  } | null
}

/**
 * '' e '   ' contam como ausente: quem apaga o textarea do torneio quer
 * voltar a herdar do evento, não gravar um texto vazio que "vence" por engano.
 */
export function presentOrNull(v: string | null | undefined): string | null {
  const trimmed = (v ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveField(
  tournamentValue: string | null,
  event: ContentSources['event'],
  eventValue: string | null,
): ResolvedText | null {
  const own = presentOrNull(tournamentValue)
  if (own !== null) return { text: own, origin: 'tournament', sourceName: null, sourceSlug: null }

  const inherited = presentOrNull(eventValue)
  if (inherited !== null && event) {
    return { text: inherited, origin: 'event', sourceName: event.name, sourceSlug: event.slug }
  }
  return null
}

export function resolveTournamentContent(s: ContentSources): {
  description: ResolvedText | null
  rules: ResolvedText | null
  venue: ResolvedText | null
} {
  return {
    description: resolveField(s.tournament.description, s.event, s.event?.description ?? null),
    rules: resolveField(s.tournament.rules, s.event, s.event?.rules ?? null),
    venue: resolveField(s.tournament.venue, s.event, s.event?.venue ?? null),
  }
}
