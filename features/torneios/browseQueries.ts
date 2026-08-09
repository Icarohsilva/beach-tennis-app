// features/torneios/browseQueries.ts
// Leitura da vitrine de torneios: a linha do torneio somada aos números que o
// card mostra (vagas ocupadas, lista de espera, se o aluno está dentro) e ao
// campeão de quem já encerrou.
//
// Vem tudo numa passada só. A alternativa — uma contagem por torneio — daria
// N+1 consultas numa página que abre a cada visita à aba Arena.
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import { teamLabel } from '@/lib/torneios/display'
import type { BrowseTournament } from '@/lib/torneios/browse'
import type { Tournament } from '@/types'

export interface TournamentBrowseData {
  tournaments: BrowseTournament[]
  /** id do torneio -> nome do campeão (com o parceiro, quando havia dupla). */
  championById: Record<string, string>
}

const EMPTY: TournamentBrowseData = { tournaments: [], championById: {} }

// Colunas do torneio que a vitrine usa. `select('*')` traria pix_key e chaves de
// vencedor para uma lista que não precisa delas.
const TOURNAMENT_COLUMNS = `id, name, date, sport, status, level, category, participant_type,
  format, cover_image_url, entry_price_cents, max_players,
  winner1_id, winner1_partner_id`

type TournamentRow = Pick<
  Tournament,
  | 'id' | 'name' | 'date' | 'sport' | 'status' | 'level' | 'category'
  | 'participant_type' | 'format' | 'cover_image_url' | 'entry_price_cents'
  | 'max_players' | 'winner1_id' | 'winner1_partner_id'
>

interface EntryRow {
  tournament_id: string
  player_id: string
  partner_id: string | null
  entry_status: 'confirmed' | 'waitlist' | 'offered'
}

export async function getTournamentBrowse({
  orgId,
  userId,
}: {
  orgId: string | null
  userId: string
}): Promise<TournamentBrowseData> {
  if (!orgId) return EMPTY

  // O torneio em si passa pela RLS do aluno — é ela que decide o que ele pode
  // ver. O que vem depois é derivado desses ids, já validados.
  const supabase = createClient()
  const rows = await fetchAllPages<TournamentRow>(
    (from, to) =>
      supabase
        .from('tournaments')
        .select(TOURNAMENT_COLUMNS)
        .eq('organization_id', orgId)
        .neq('status', 'draft')
        .order('date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: TournamentRow[] | null; error: { message: string } | null }>,
    { label: 'torneios/browse' },
  )

  if (rows.length === 0) return EMPTY

  const ids = rows.map((t) => t.id)
  const [entries, championById] = await Promise.all([
    readEntries(orgId, ids),
    readChampions(rows),
  ])

  // `max_players` é comparado contra confirmed+offered em `registerForTournament`
  // (via availableSlots). A vitrine conta igual, senão o card anunciaria vaga que
  // a inscrição recusa.
  const occupied = new Map<string, number>()
  const waiting = new Map<string, number>()
  const mine = new Set<string>()
  for (const e of entries) {
    if (e.entry_status === 'waitlist') {
      waiting.set(e.tournament_id, (waiting.get(e.tournament_id) ?? 0) + 1)
    } else {
      occupied.set(e.tournament_id, (occupied.get(e.tournament_id) ?? 0) + 1)
    }
    if (e.player_id === userId || e.partner_id === userId) mine.add(e.tournament_id)
  }

  const tournaments: BrowseTournament[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    date: t.date,
    sport: t.sport,
    status: t.status,
    level: t.level,
    category: t.category,
    participant_type: t.participant_type,
    format: t.format,
    cover_image_url: t.cover_image_url,
    entry_price_cents: t.entry_price_cents,
    max_players: t.max_players,
    occupiedCount: occupied.get(t.id) ?? 0,
    waitlistCount: waiting.get(t.id) ?? 0,
    isMine: mine.has(t.id),
  }))

  return { tournaments, championById }
}

/**
 * Inscrições dos torneios listados.
 *
 * Vai pela service role de propósito: a RLS de `tournament_entries` só deixa o
 * aluno ver a própria inscrição, então pelo cliente dele toda vaga apareceria
 * livre. Os ids já saíram de uma consulta com RLS na org do aluno, então não há
 * como pescar torneio de outra academia — e o `eq(organization_id)` fecha.
 */
async function readEntries(orgId: string, tournamentIds: string[]): Promise<EntryRow[]> {
  const admin = createAdminClient()
  const out: EntryRow[] = []
  // Os ids viajam na URL: em lote grande a query estoura o limite do PostgREST.
  for (const part of chunk(tournamentIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<EntryRow>(
      (from, to) =>
        admin
          .from('tournament_entries')
          .select('tournament_id, player_id, partner_id, entry_status')
          .eq('organization_id', orgId)
          .in('tournament_id', part)
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: { message: string } | null }>,
      { label: 'torneios/browse-entries' },
    )
    out.push(...rows)
  }
  return out
}

/** Nome do campeão dos torneios encerrados, para o card do que já passou. */
async function readChampions(rows: TournamentRow[]): Promise<Record<string, string>> {
  const withWinner = rows.filter((t) => t.status === 'finished' && t.winner1_id)
  if (withWinner.length === 0) return {}

  const profileIds = Array.from(
    new Set(
      withWinner.flatMap((t) => [t.winner1_id, t.winner1_partner_id].filter((id): id is string => !!id)),
    ),
  )

  const admin = createAdminClient()
  const names = new Map<string, string>()
  for (const part of chunk(profileIds, IN_CHUNK_SIZE)) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', part)
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name)
    }
  }

  const out: Record<string, string> = {}
  for (const t of withWinner) {
    const label = teamLabel([
      names.get(t.winner1_id as string),
      t.winner1_partner_id ? names.get(t.winner1_partner_id) : null,
    ])
    // teamLabel devolve 'A definir' quando não resolveu nome nenhum — nesse caso
    // é melhor o card não falar de campeão do que anunciar um placeholder.
    if (label !== 'A definir') out[t.id] = label
  }
  return out
}
