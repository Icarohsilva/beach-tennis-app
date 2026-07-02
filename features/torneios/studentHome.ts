// features/torneios/studentHome.ts
import { createAdminClient } from '@/lib/supabase/server'
import { pickNextMatch } from '@/lib/torneios/nextMatch'
import { teamLabel } from '@/lib/torneios/display'
import type { TournamentStatus } from '@/types'

export interface MyTournamentSummary {
  id: string
  name: string
  date: string
  status: TournamentStatus
}

export interface NextMatchSummary {
  matchId: string
  tournamentId: string
  tournamentName: string
  playedAt: string
  team1: string
  team2: string
  mySide: 1 | 2
}

export interface StudentTournamentHome {
  myTournaments: MyTournamentSummary[]
  myTournamentIds: Set<string>
  nextMatch: NextMatchSummary | null
}

const EMPTY: StudentTournamentHome = {
  myTournaments: [],
  myTournamentIds: new Set(),
  nextMatch: null,
}

type ProfRef = { full_name: string } | { full_name: string }[] | null | undefined
function profName(p: ProfRef): string | null {
  if (!p) return null
  const obj = Array.isArray(p) ? p[0] : p
  return obj?.full_name ?? null
}

export async function getStudentTournamentHome(
  { orgId, userId }: { orgId: string | null; userId: string },
): Promise<StudentTournamentHome> {
  if (!orgId) return EMPTY
  const admin = createAdminClient()

  // 1) Inscrições do aluno (como titular ou parceiro)
  const { data: entriesRaw } = await admin
    .from('tournament_entries')
    .select('tournament_id')
    .eq('organization_id', orgId)
    .or(`player_id.eq.${userId},partner_id.eq.${userId}`)

  const entryIds = Array.from(
    new Set(((entriesRaw ?? []) as { tournament_id: string }[]).map((e) => e.tournament_id)),
  )
  if (entryIds.length === 0) return EMPTY

  // 2) Torneios ativos (inscrições abertas ou em andamento)
  const { data: tournamentsRaw } = await admin
    .from('tournaments')
    .select('id, name, date, status')
    .eq('organization_id', orgId)
    .in('id', entryIds)
    .in('status', ['open', 'in_progress'])
    .order('date', { ascending: true })

  const myTournaments = (tournamentsRaw ?? []) as MyTournamentSummary[]
  const activeIds = myTournaments.map((t) => t.id)
  const myTournamentIds = new Set(activeIds)
  if (activeIds.length === 0) {
    return { myTournaments, myTournamentIds, nextMatch: null }
  }

  // 3) Próximo confronto agendado do aluno nesses torneios
  const { data: matchesRaw } = await admin
    .from('tournament_matches')
    .select(`id, tournament_id, played_at, result_status,
      player1_id, partner1_id, player2_id, partner2_id,
      player1:profiles!player1_id(full_name),
      partner1:profiles!partner1_id(full_name),
      player2:profiles!player2_id(full_name),
      partner2:profiles!partner2_id(full_name)`)
    .eq('organization_id', orgId)
    .in('tournament_id', activeIds)
    .or(
      `player1_id.eq.${userId},partner1_id.eq.${userId},player2_id.eq.${userId},partner2_id.eq.${userId}`,
    )

  type MatchRow = {
    id: string
    tournament_id: string
    played_at: string | null
    result_status: 'pending' | 'confirmed' | null
    player1_id: string
    partner1_id: string | null
    player2_id: string
    partner2_id: string | null
    player1: ProfRef
    partner1: ProfRef
    player2: ProfRef
    partner2: ProfRef
  }
  const matches = (matchesRaw ?? []) as unknown as MatchRow[]
  const picked = pickNextMatch(matches, new Date())

  let nextMatch: NextMatchSummary | null = null
  if (picked && picked.played_at) {
    const mySide: 1 | 2 =
      picked.player1_id === userId || picked.partner1_id === userId ? 1 : 2
    const tournamentName =
      myTournaments.find((t) => t.id === picked.tournament_id)?.name ?? 'Torneio'
    nextMatch = {
      matchId: picked.id,
      tournamentId: picked.tournament_id,
      tournamentName,
      playedAt: picked.played_at,
      team1: teamLabel([profName(picked.player1), profName(picked.partner1)]),
      team2: teamLabel([profName(picked.player2), profName(picked.partner2)]),
      mySide,
    }
  }

  return { myTournaments, myTournamentIds, nextMatch }
}
