// features/liga/tournamentPoints.ts
// Pontos de torneio na Liga: participar e subir no pódio (spec §Fase 1).
import { createAdminClient } from '@/lib/supabase/server'
import { pointsForTournamentResult } from '@/lib/liga/points'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason } from './season'
import { awardLigaPoints, revokeLigaPoints } from './awardPoints'

type AdminClient = ReturnType<typeof createAdminClient>

interface TournamentRow {
  sport: string | null
  winner1_id: string | null
  winner1_partner_id: string | null
  winner2_id: string | null
  winner2_partner_id: string | null
  winner3_id: string | null
  winner3_partner_id: string | null
}

async function loadTournament(
  admin: AdminClient,
  orgId: string,
  tournamentId: string,
): Promise<TournamentRow | null> {
  const { data } = await admin
    .from('tournaments')
    .select(
      'sport, winner1_id, winner1_partner_id, winner2_id, winner2_partner_id, winner3_id, winner3_partner_id',
    )
    .eq('id', tournamentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return (data as TournamentRow | null) ?? null
}

/** Crédito por participar. Chamado quando a inscrição fica confirmada. */
export async function awardTournamentEntry(
  admin: AdminClient,
  input: { orgId: string; tournamentId: string; studentId: string },
): Promise<void> {
  try {
    const settings = await getLigaSettings(input.orgId)
    if (!settings.enabled) return

    const tournament = await loadTournament(admin, input.orgId, input.tournamentId)
    const sport = tournament?.sport
    if (!sport) return

    const season = await getOrCreateActiveSeason(input.orgId)
    if (!season) return

    await awardLigaPoints(admin, {
      orgId: input.orgId,
      seasonId: season.id,
      studentId: input.studentId,
      sport,
      points: settings.weights.tournamentEntry,
      reason: 'tournament_entry',
      sourceId: input.tournamentId,
    })
  } catch (err) {
    console.error('[liga] awardTournamentEntry falhou', {
      tournamentId: input.tournamentId,
      studentId: input.studentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Recredita o pódio inteiro do torneio.
 *
 * Idempotente e corrigível: revoga o crédito de resultado de todos os envolvidos antes
 * de creditar de novo. É o que faz `updateWinners` (correção manual do pódio pelo
 * admin) funcionar sem deixar ponto de vencedor antigo para trás.
 */
export async function syncTournamentResultPoints(
  admin: AdminClient,
  input: { orgId: string; tournamentId: string; previousWinnerIds?: string[] },
): Promise<void> {
  const { orgId, tournamentId } = input

  try {
    const settings = await getLigaSettings(orgId)
    if (!settings.enabled) return

    const tournament = await loadTournament(admin, orgId, tournamentId)
    const sport = tournament?.sport
    if (!sport) return

    const season = await getOrCreateActiveSeason(orgId)
    if (!season) return

    const podium: { studentIds: string[]; place: 1 | 2 | 3 }[] = [
      { studentIds: [tournament.winner1_id, tournament.winner1_partner_id].filter(Boolean) as string[], place: 1 },
      { studentIds: [tournament.winner2_id, tournament.winner2_partner_id].filter(Boolean) as string[], place: 2 },
      { studentIds: [tournament.winner3_id, tournament.winner3_partner_id].filter(Boolean) as string[], place: 3 },
    ]

    // Revoga o resultado anterior de todo mundo que já teve ou tem pódio.
    const toRevoke = new Set<string>([
      ...(input.previousWinnerIds ?? []),
      ...podium.flatMap((p) => p.studentIds),
    ])
    for (const studentId of Array.from(toRevoke)) {
      await revokeLigaPoints(admin, {
        seasonId: season.id,
        studentId,
        sport,
        reason: 'tournament_result',
        sourceId: tournamentId,
      })
    }

    for (const { studentIds, place } of podium) {
      const points = pointsForTournamentResult(place, settings.weights)
      if (points <= 0) continue
      for (const studentId of studentIds) {
        await awardLigaPoints(admin, {
          orgId,
          seasonId: season.id,
          studentId,
          sport,
          points,
          reason: 'tournament_result',
          sourceId: tournamentId,
          note: `${place}º lugar`,
        })
      }
    }
  } catch (err) {
    console.error('[liga] syncTournamentResultPoints falhou', {
      tournamentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
