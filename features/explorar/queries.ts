// features/explorar/queries.ts
// A descoberta é a única leitura do app que NÃO é escopada por academia.
//
// Todo o resto filtra por `organization_id` para não vazar entre academias.
// Aqui o objetivo é o oposto: mostrar o que está aberto ao público em todas as
// arenas. O que delimita não é o vínculo da pessoa, é a vontade da academia —
// `organizations.is_listed`, o mesmo interruptor que já governa o diretório
// público /arenas. Academia que não quer aparecer não aparece aqui também.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import type { NearbyArena } from '@/lib/explorar/nearby'
import type { Tournament } from '@/types'

/** Torneio aberto de qualquer arena listada, com o nome da arena junto. */
export interface DiscoverTournament {
  id: string
  name: string
  date: string
  sport: string
  format: string
  level: string
  category: string
  participant_type: 'individual' | 'dupla_fixa' | 'dupla_revezando'
  cover_image_url: string | null
  entry_price_cents: number | null
  max_players: number | null
  occupiedCount: number
  organization_id: string
  orgName: string
  orgSlug: string
  orgCity: string | null
}

export interface DiscoverData {
  arenas: NearbyArena[]
  tournaments: DiscoverTournament[]
}

const EMPTY: DiscoverData = { arenas: [], tournaments: [] }

interface OrgRow {
  id: string
  name: string
  slug: string
  city: string | null
  neighborhood: string | null
  state: string | null
  sports: string[] | null
  latitude: number | null
  longitude: number | null
}

/**
 * Arenas listadas + o que está aberto nelas.
 *
 * Uma passada por tabela, não uma por arena: numa plataforma com mil arenas o
 * caminho por-arena seriam mil consultas a cada abertura da aba.
 */
export async function getDiscoverData(today: string): Promise<DiscoverData> {
  const admin = createAdminClient()

  // `is_listed` é o consentimento da academia em aparecer publicamente.
  const orgRows = await fetchAllPages<OrgRow>(
    (from, to) =>
      admin
        .from('organizations')
        .select('id, name, slug, city, neighborhood, state, sports, latitude, longitude')
        .eq('status', 'active')
        .eq('is_listed', true)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: OrgRow[] | null; error: { message: string } | null }>,
    { label: 'explorar/orgs' },
  )

  if (orgRows.length === 0) return EMPTY
  const orgIds = orgRows.map((o) => o.id)

  const [tournamentRows, dayUseCounts] = await Promise.all([
    readOpenTournaments(orgIds, today),
    countOpenDayUse(orgIds, today),
  ])

  // Ocupação de cada torneio, para o card dizer quantas vagas sobraram. Mesma
  // contagem de availableSlots: 'offered' já ocupa vaga.
  const entryCounts = await countEntries(tournamentRows.map((t) => t.id))

  const orgById = new Map(orgRows.map((o) => [o.id, o]))
  const tournaments: DiscoverTournament[] = tournamentRows.map((t) => {
    const org = orgById.get(t.organization_id)
    return {
      id: t.id,
      name: t.name,
      date: t.date,
      sport: t.sport,
      format: t.format,
      level: t.level,
      category: t.category,
      participant_type: t.participant_type,
      cover_image_url: t.cover_image_url,
      entry_price_cents: t.entry_price_cents,
      max_players: t.max_players,
      occupiedCount: entryCounts.get(t.id) ?? 0,
      organization_id: t.organization_id,
      orgName: org?.name ?? 'Arena',
      orgSlug: org?.slug ?? '',
      orgCity: org?.city ?? null,
    }
  })

  const tournamentsByOrg = new Map<string, number>()
  for (const t of tournaments) {
    tournamentsByOrg.set(t.organization_id, (tournamentsByOrg.get(t.organization_id) ?? 0) + 1)
  }

  const arenas: NearbyArena[] = orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    city: o.city,
    neighborhood: o.neighborhood,
    state: o.state,
    sports: o.sports ?? [],
    latitude: o.latitude,
    longitude: o.longitude,
    openTournaments: tournamentsByOrg.get(o.id) ?? 0,
    openDayUse: dayUseCounts.get(o.id) ?? 0,
  }))

  return { arenas, tournaments }
}

type TournamentRow = Pick<
  Tournament,
  | 'id' | 'organization_id' | 'name' | 'date' | 'sport' | 'format' | 'level'
  | 'category' | 'participant_type' | 'cover_image_url' | 'entry_price_cents' | 'max_players'
>

async function readOpenTournaments(orgIds: string[], today: string): Promise<TournamentRow[]> {
  const admin = createAdminClient()
  const out: TournamentRow[] = []
  // Os ids viajam na URL do PostgREST: em lote grande a query estoura.
  for (const part of chunk(orgIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<TournamentRow>(
      (from, to) =>
        admin
          .from('tournaments')
          .select('id, organization_id, name, date, sport, format, level, category, participant_type, cover_image_url, entry_price_cents, max_players')
          .in('organization_id', part)
          .eq('status', 'open')
          // Torneio aberto com data vencida é esquecimento do admin, não convite.
          .gte('date', today)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: TournamentRow[] | null; error: { message: string } | null }>,
      { label: 'explorar/tournaments' },
    )
    out.push(...rows)
  }
  return out
}

async function countOpenDayUse(orgIds: string[], today: string): Promise<Map<string, number>> {
  const admin = createAdminClient()
  const counts = new Map<string, number>()
  for (const part of chunk(orgIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ organization_id: string }>(
      (from, to) =>
        admin
          .from('dayuse_slots')
          .select('organization_id')
          .in('organization_id', part)
          .eq('is_active', true)
          .gte('date', today)
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: { organization_id: string }[] | null; error: { message: string } | null }>,
      { label: 'explorar/dayuse' },
    )
    for (const r of rows) {
      counts.set(r.organization_id, (counts.get(r.organization_id) ?? 0) + 1)
    }
  }
  return counts
}

async function countEntries(tournamentIds: string[]): Promise<Map<string, number>> {
  if (tournamentIds.length === 0) return new Map()
  const admin = createAdminClient()
  const counts = new Map<string, number>()
  for (const part of chunk(tournamentIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ tournament_id: string }>(
      (from, to) =>
        admin
          .from('tournament_entries')
          .select('tournament_id')
          .in('tournament_id', part)
          .in('entry_status', ['confirmed', 'offered'])
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: { tournament_id: string }[] | null; error: { message: string } | null }>,
      { label: 'explorar/entries' },
    )
    for (const r of rows) {
      counts.set(r.tournament_id, (counts.get(r.tournament_id) ?? 0) + 1)
    }
  }
  return counts
}
