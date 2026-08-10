// features/torneios/eventQueries.ts
// Leitura do evento de torneio e da vitrine pública da arena.
//
// As duas páginas que isto alimenta (/e/[slug] e /arenas/[slug]) abrem SEM
// login — são o que a academia divulga no Instagram. Por isso a leitura passa
// pela service role e o recorte de visibilidade é explícito aqui: evento
// publicado, torneio fora de rascunho, academia ativa e listada.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import type { EventTournament } from '@/lib/torneios/event'
import type { TournamentEvent } from '@/types'

export interface EventPageData {
  event: TournamentEvent
  org: {
    id: string
    name: string
    slug: string
    city: string | null
    state: string | null
    logo_url: string | null
    brand_color: string | null
    whatsapp: string | null
  }
  tournaments: EventTournament[]
}

const TOURNAMENT_COLUMNS =
  'id, name, date, sport, category, level, participant_type, format, status, entry_price_cents, max_players'

/** Evento publicado pelo slug, com a academia e os torneios vinculados. */
export async function getEventBySlug(slug: string): Promise<EventPageData | null> {
  const admin = createAdminClient()

  const { data: eventRow } = await admin
    .from('tournament_events')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()
  if (!eventRow) return null
  const event = eventRow as TournamentEvent

  const { data: orgRow } = await admin
    .from('organizations')
    .select('id, name, slug, city, state, logo_url, brand_color, whatsapp, status')
    .eq('id', event.organization_id)
    .maybeSingle()
  // Academia suspensa não divulga: a página do evento dela sai do ar junto.
  if (!orgRow || (orgRow as { status: string }).status !== 'active') return null

  const { data: rows } = await admin
    .from('tournaments')
    .select(TOURNAMENT_COLUMNS)
    .eq('event_id', event.id)
    .neq('status', 'draft')
    .order('date', { ascending: true })

  const tournaments = await withEntryCounts((rows ?? []) as RawTournament[])

  return {
    event,
    org: orgRow as EventPageData['org'],
    tournaments,
  }
}

type RawTournament = Omit<EventTournament, 'occupiedCount'>

/**
 * Ocupação de cada torneio numa consulta só.
 *
 * Conta `confirmed` + `offered`, igual ao availableSlots de
 * registerForTournament — senão a página anunciaria vaga que a inscrição recusa.
 */
async function withEntryCounts(rows: RawTournament[]): Promise<EventTournament[]> {
  if (rows.length === 0) return []
  const admin = createAdminClient()
  const counts = new Map<string, number>()

  for (const part of chunk(rows.map((r) => r.id), IN_CHUNK_SIZE)) {
    const entries = await fetchAllPages<{ tournament_id: string }>(
      (from, to) =>
        admin
          .from('tournament_entries')
          .select('tournament_id')
          .in('tournament_id', part)
          .in('entry_status', ['confirmed', 'offered'])
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: { tournament_id: string }[] | null
          error: { message: string } | null
        }>,
      { label: 'evento/entries' },
    )
    for (const e of entries) {
      counts.set(e.tournament_id, (counts.get(e.tournament_id) ?? 0) + 1)
    }
  }

  return rows.map((r) => ({ ...r, occupiedCount: counts.get(r.id) ?? 0 }))
}

// --- Vitrine da arena --------------------------------------------------------

export interface ArenaShowcase {
  /** Eventos publicados que ainda não terminaram, do mais próximo. */
  events: Array<Pick<TournamentEvent, 'id' | 'name' | 'slug' | 'starts_on' | 'ends_on' | 'cover_image_url'> & {
    tournamentCount: number
  }>
  /** Torneios abertos que NÃO estão dentro de um evento (esses aparecem na capa do evento). */
  looseTournaments: EventTournament[]
  /** Horários de day use ainda disponíveis. */
  dayUse: Array<{ id: string; date: string; start_time: string; end_time: string; court: number }>
  /** Comunicados fixados pela academia no mural. */
  notices: Array<{ id: string; content: string; created_at: string }>
}

/**
 * O que a arena tem para mostrar a quem chegou pelo link divulgado.
 *
 * Torneio dentro de evento é omitido da lista solta de propósito: ele já está
 * anunciado pela capa do evento, e repetir os seis torneios da Copa de Agosto
 * fora dela transformaria a página num paredão.
 */
export async function getArenaShowcase(orgId: string, today: string): Promise<ArenaShowcase> {
  const admin = createAdminClient()

  const [{ data: eventRows }, { data: tournamentRows }, { data: dayUseRows }, { data: noticeRows }] =
    await Promise.all([
      admin
        .from('tournament_events')
        .select('id, name, slug, starts_on, ends_on, cover_image_url')
        .eq('organization_id', orgId)
        .eq('is_published', true)
        // Evento que já acabou sai da vitrine; o link direto continua abrindo.
        .or(`ends_on.gte.${today},and(ends_on.is.null,starts_on.gte.${today})`)
        .order('starts_on', { ascending: true })
        .limit(6),
      admin
        .from('tournaments')
        .select(TOURNAMENT_COLUMNS)
        .eq('organization_id', orgId)
        .eq('status', 'open')
        .gte('date', today)
        .is('event_id', null)
        .order('date', { ascending: true })
        .limit(8),
      admin
        .from('dayuse_slots')
        .select('id, date, start_time, end_time, court')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .gte('date', today)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(6),
      admin
        .from('posts')
        .select('id, content, created_at')
        .eq('organization_id', orgId)
        .eq('is_pinned', true)
        .order('created_at', { ascending: false })
        .limit(3),
    ])

  const events = (eventRows ?? []) as ArenaShowcase['events']
  // Quantos torneios cada evento tem — é o número que dá volume à capa.
  if (events.length > 0) {
    const { data: countRows } = await admin
      .from('tournaments')
      .select('event_id')
      .in('event_id', events.map((e) => e.id))
      .neq('status', 'draft')
    const counts = new Map<string, number>()
    for (const r of (countRows ?? []) as { event_id: string }[]) {
      counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1)
    }
    for (const e of events) e.tournamentCount = counts.get(e.id) ?? 0
  }

  // event_id não vem no select: o filtro `.is('event_id', null)` já garante que
  // aqui só há torneio solto.
  const looseTournaments = await withEntryCounts((tournamentRows ?? []) as RawTournament[])

  return {
    events,
    looseTournaments,
    dayUse: (dayUseRows ?? []) as ArenaShowcase['dayUse'],
    notices: (noticeRows ?? []) as ArenaShowcase['notices'],
  }
}
