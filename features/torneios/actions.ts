'use server'
// features/torneios/actions.ts

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import type { StudentLevel, TournamentStatus, TournamentFormat, TournamentModality } from '@/types'

// ---------------------------------------------------------------------------
// createTournament — admin only
// ---------------------------------------------------------------------------

export async function createTournament(input: {
  name: string
  date: string
  format: TournamentFormat
  modality: TournamentModality
  level: StudentLevel
}): Promise<{ error?: string; id?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Verify admin role
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return { error: 'Sem permissão.' }

  const { data, error } = await adminClient
    .from('tournaments')
    .insert({
      name: input.name,
      date: input.date,
      format: input.format,
      modality: input.modality,
      level: input.level,
      status: 'draft' as TournamentStatus,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !data) return { error: 'Erro ao criar torneio. Tente novamente.' }
  return { id: data.id }
}

// ---------------------------------------------------------------------------
// registerForTournament — student
// ---------------------------------------------------------------------------

export async function registerForTournament(
  tournamentId: string,
  partnerId?: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Fetch tournament
  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status, level, modality')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }

  // Only open tournaments accept registrations
  if (tournament.status !== 'open') {
    return { error: 'Inscrições encerradas para este torneio.' }
  }

  // Fetch student profile
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id, level')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'Perfil não encontrado.' }

  // Level validation
  if (!canStudentAttendLevel(profile.level as StudentLevel, tournament.level as StudentLevel)) {
    return {
      error: `Seu nível (${profile.level}) não permite participar deste torneio (${tournament.level}).`,
    }
  }

  // Check duplicate registration
  const { count: dupCount } = await adminClient
    .from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .eq('player_id', user.id)

  if ((dupCount ?? 0) > 0) {
    return { error: 'Você já está inscrito neste torneio.' }
  }

  // Insert registration
  const { error: insertErr } = await adminClient
    .from('tournament_registrations')
    .insert({
      tournament_id: tournamentId,
      player_id: user.id,
      partner_id: tournament.modality === 'dupla_fixa' ? (partnerId ?? null) : null,
    })

  if (insertErr) return { error: 'Erro ao realizar inscrição. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// recordMatchResult — admin only
// ---------------------------------------------------------------------------

export async function recordMatchResult(
  matchId: string,
  score: string,
  winnerId: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Verify admin role
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return { error: 'Sem permissão.' }

  // Fetch match with tournament
  const { data: match, error: matchErr } = await adminClient
    .from('tournament_matches')
    .select('id, player1_id, player2_id, tournament_id, tournament:tournaments(status)')
    .eq('id', matchId)
    .single()

  if (matchErr || !match) return { error: 'Confronto não encontrado.' }

  // Tournament must be in_progress
  const tournamentRaw = Array.isArray(match.tournament) ? match.tournament[0] : match.tournament
  const tournament = tournamentRaw as { status: TournamentStatus } | null
  if (tournament?.status !== 'in_progress') {
    return { error: 'O torneio precisa estar em andamento para lançar resultados.' }
  }

  // winner_id must be player1 or player2
  if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
    return { error: 'Vencedor inválido: deve ser um dos participantes do confronto.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournament_matches')
    .update({ score, winner_id: winnerId })
    .eq('id', matchId)

  if (updateErr) return { error: 'Erro ao salvar resultado. Tente novamente.' }
  return {}
}

// ---------------------------------------------------------------------------
// updateTournamentStatus — admin only
// ---------------------------------------------------------------------------

const STATUS_ORDER: TournamentStatus[] = ['draft', 'open', 'in_progress', 'finished']

export async function updateTournamentStatus(
  tournamentId: string,
  newStatus: TournamentStatus,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Verify admin role
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return { error: 'Sem permissão.' }

  // Fetch current status
  const { data: tournament, error: tErr } = await adminClient
    .from('tournaments')
    .select('id, status')
    .eq('id', tournamentId)
    .single()

  if (tErr || !tournament) return { error: 'Torneio não encontrado.' }

  const currentIdx = STATUS_ORDER.indexOf(tournament.status as TournamentStatus)
  const newIdx = STATUS_ORDER.indexOf(newStatus)

  // Enforce unidirectional flow — new status must be exactly one step forward
  if (newIdx !== currentIdx + 1) {
    return { error: 'Transição de status inválida. O fluxo é: rascunho → aberto → em andamento → encerrado.' }
  }

  const { error: updateErr } = await adminClient
    .from('tournaments')
    .update({ status: newStatus })
    .eq('id', tournamentId)

  if (updateErr) return { error: 'Erro ao atualizar status. Tente novamente.' }
  return {}
}
