// features/torneios/playerStatsQueries.ts
// Busca o histórico de torneios de um atleta para montar o retrospecto.
//
// Vai pela service role porque a RLS de `profiles` impede o aluno de ler o nome
// dos outros participantes — o mesmo motivo pelo qual a página do torneio já
// usa admin client. O recorte por `organization_id` é o que garante que o
// retrospecto é o daquela academia, e não de todas as que o atleta frequenta.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import type { PlayerMatch, PodiumFinish } from '@/lib/torneios/playerStats'

export interface PlayerTournamentProfile {
  playerId: string
  name: string
  /** Partidas confirmadas, em ordem cronológica (a mais antiga primeiro). */
  matches: PlayerMatch[]
  podiums: PodiumFinish[]
  /** Nome de todo mundo citado (adversários, parceiros). */
  nameById: Record<string, string>
  /** Torneios distintos disputados. */
  tournamentCount: number
}

interface MatchRow {
  id: string
  tournament_id: string
  round: number
  match_no: number | null
  player1_id: string | null
  partner1_id: string | null
  player2_id: string | null
  partner2_id: string | null
  games1: number | null
  games2: number | null
}

interface TournamentRow {
  id: string
  name: string
  date: string
  winner1_id: string | null
  winner1_partner_id: string | null
  winner2_id: string | null
  winner2_partner_id: string | null
  winner3_id: string | null
  winner3_partner_id: string | null
}

export async function getPlayerTournamentProfile({
  orgId,
  playerId,
}: {
  orgId: string | null
  playerId: string
}): Promise<PlayerTournamentProfile | null> {
  if (!orgId) return null
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('id', playerId)
    .maybeSingle()
  if (!profile) return null

  // Só placar confirmado entra no retrospecto: um placar pendente ainda pode
  // ser contestado pela dupla adversária.
  const matchRows = await fetchAllPages<MatchRow>(
    (from, to) =>
      admin
        .from('tournament_matches')
        .select('id, tournament_id, round, match_no, player1_id, partner1_id, player2_id, partner2_id, games1, games2')
        .eq('organization_id', orgId)
        .eq('result_status', 'confirmed')
        .or(
          `player1_id.eq.${playerId},partner1_id.eq.${playerId},player2_id.eq.${playerId},partner2_id.eq.${playerId}`,
        )
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: MatchRow[] | null; error: { message: string } | null }>,
    { label: 'torneios/player-stats' },
  )

  const tournamentIds = Array.from(new Set(matchRows.map((m) => m.tournament_id)))

  // Os torneios servem para dois fins: dar nome e data às partidas (que é como
  // a ordenação cronológica sai) e apurar o pódio já congelado no fechamento.
  const tournaments = new Map<string, TournamentRow>()
  for (const part of chunk(tournamentIds, IN_CHUNK_SIZE)) {
    const { data } = await admin
      .from('tournaments')
      .select('id, name, date, winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id')
      .eq('organization_id', orgId)
      .in('id', part)
    for (const row of (data ?? []) as TournamentRow[]) tournaments.set(row.id, row)
  }

  // O pódio pode existir em torneio onde o atleta não tem partida registrada
  // (chave lançada só no fim), então vem de uma busca própria.
  const { data: podiumRows } = await admin
    .from('tournaments')
    .select('id, winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id')
    .eq('organization_id', orgId)
    .eq('status', 'finished')
    .or(
      `winner1_id.eq.${playerId},winner1_partner_id.eq.${playerId},winner2_id.eq.${playerId},winner2_partner_id.eq.${playerId},winner3_id.eq.${playerId},winner3_partner_id.eq.${playerId}`,
    )

  const podiums: PodiumFinish[] = []
  for (const row of (podiumRows ?? []) as TournamentRow[]) {
    const position =
      row.winner1_id === playerId || row.winner1_partner_id === playerId ? 1
      : row.winner2_id === playerId || row.winner2_partner_id === playerId ? 2
      : row.winner3_id === playerId || row.winner3_partner_id === playerId ? 3
      : null
    if (position) podiums.push({ tournamentId: row.id, position: position as 1 | 2 | 3 })
  }

  // A posição na chave só existe para ordenar; não faz parte de PlayerMatch.
  type Sortable = PlayerMatch & { sortRound: number; sortMatchNo: number }
  const matches: PlayerMatch[] = matchRows
    .map((m): Sortable => {
      const tournament = tournaments.get(m.tournament_id)
      return {
        id: m.id,
        tournamentId: m.tournament_id,
        tournamentName: tournament?.name ?? 'Torneio',
        date: tournament?.date ?? '',
        side1: [m.player1_id, m.partner1_id].filter((x): x is string => !!x),
        side2: [m.player2_id, m.partner2_id].filter((x): x is string => !!x),
        games1: m.games1 ?? 0,
        games2: m.games2 ?? 0,
        sortRound: m.round,
        sortMatchNo: m.match_no ?? 0,
      }
    })
    // Cronológica de verdade: `played_at` costuma vir nulo (nem todo confronto é
    // agendado), então a ordem sai da data do torneio e da posição na chave. É
    // dessa ordem que dependem a forma recente e a sequência atual.
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.tournamentId.localeCompare(b.tournamentId) ||
        a.sortRound - b.sortRound ||
        a.sortMatchNo - b.sortMatchNo,
    )
    .map(({ sortRound: _r, sortMatchNo: _m, ...rest }) => rest)

  // Nomes de todo mundo que aparece ao lado ou contra.
  const peopleIds = Array.from(
    new Set(matches.flatMap((m) => [...m.side1, ...m.side2]).filter((id) => id !== playerId)),
  )
  const nameById: Record<string, string> = { [playerId]: profile.full_name ?? 'Atleta' }
  for (const part of chunk(peopleIds, IN_CHUNK_SIZE)) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', part)
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) nameById[p.id] = p.full_name
    }
  }

  return {
    playerId,
    name: profile.full_name ?? 'Atleta',
    matches,
    podiums,
    nameById,
    tournamentCount: tournamentIds.length,
  }
}
