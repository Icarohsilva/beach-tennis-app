// features/liga/seasonClose.ts
// Fecha a temporada, move as divisões e abre a temporada nova (spec §Fechamento).
import { createAdminClient } from '@/lib/supabase/server'
import {
  computeDivisionMoves,
  DIVISION_ORDER,
  type Division,
  type StandingRow,
} from '@/lib/liga/divisions'
import { awardSeasonPrizes, type PromotionMove } from './prizes'
import { getLigaSettings } from './settings'
import { getOrCreateActiveSeason, monthBounds } from './season'
import type { LigaSeason } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

interface StandingDbRow {
  student_id: string
  sport: string
  division: Division
  points: number
  streak_weeks: number
}

export interface SeasonCloseResult {
  closed: boolean
  promoted: number
  demoted: number
  carried: number
  /** Prêmios apurados para a temporada que fechou. */
  prizes: number
}

/**
 * Fecha a temporada anterior de uma academia e cria a do mês corrente.
 *
 * Idempotente: se já existe temporada para o mês corrente, não faz nada. O
 * `unique (organization_id, starts_on)` é a garantia final.
 *
 * `streak_weeks` é copiado para a temporada nova: a sequência é do aluno naquele
 * esporte e atravessa temporadas — zerá-la no dia 1º puniria quem nunca faltou.
 */
export async function closeLigaSeason(
  admin: AdminClient,
  orgId: string,
  now: Date = new Date(),
): Promise<SeasonCloseResult> {
  const empty: SeasonCloseResult = {
    closed: false,
    promoted: 0,
    demoted: 0,
    carried: 0,
    prizes: 0,
  }

  const settings = await getLigaSettings(orgId)
  if (!settings.enabled) return empty

  const { startsOn } = monthBounds(now)

  // Já virou o mês? Se a temporada do mês corrente existe, o fechamento já rodou.
  const { data: current } = await admin
    .from('liga_seasons')
    .select('id')
    .eq('organization_id', orgId)
    .eq('starts_on', startsOn)
    .maybeSingle()
  if (current) return empty

  // Temporada a fechar: a ativa mais recente que não é a do mês corrente.
  const { data: previousRaw } = await admin
    .from('liga_seasons')
    .select('*')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle()

  const previous = previousRaw as LigaSeason | null

  // Nada a fechar: cria só a temporada nova (academia acabou de ligar a Liga).
  if (!previous) {
    await getOrCreateActiveSeason(orgId, now)
    return { ...empty, closed: false }
  }

  const { data: standingsRaw } = await admin
    .from('liga_standings')
    .select('student_id, sport, division, points, streak_weeks')
    .eq('season_id', previous.id)

  const standings = (standingsRaw ?? []) as StandingDbRow[]

  // Movimentação é calculada por esporte: cada ranking tem sua própria escada.
  const bySport = new Map<string, StandingDbRow[]>()
  for (const row of standings) {
    const list = bySport.get(row.sport) ?? []
    list.push(row)
    bySport.set(row.sport, list)
  }

  const nextDivision = new Map<string, Division>() // `${studentId}::${sport}` → divisão
  const promotions: PromotionMove[] = []
  let promoted = 0
  let demoted = 0

  // Array.from: o target do tsconfig não habilita downlevelIteration, então iterar o
  // Map direto não compila (mesma razão do Array.from em streakSync.ts).
  for (const [sport, rows] of Array.from(bySport.entries())) {
    const input: StandingRow[] = rows.map((r) => ({
      studentId: r.student_id,
      points: r.points,
      division: r.division,
    }))
    for (const move of computeDivisionMoves(input, settings.cuts)) {
      nextDivision.set(`${move.studentId}::${sport}`, move.to)
      // Comparar pelo índice da escada, não pelas strings: a ordem alfabética de
      // Division não reflete a hierarquia ('bronze' < 'diamante' < 'ouro' < 'prata').
      const upward = DIVISION_ORDER.indexOf(move.to) > DIVISION_ORDER.indexOf(move.from)
      if (upward) {
        promoted++
        promotions.push({ studentId: move.studentId, sport, from: move.from, to: move.to })
      } else demoted++
    }
  }

  // Prêmios ANTES de virar a temporada: a apuração depende dos standings finais
  // dela e da lista de promovidos que acabou de ser calculada.
  const prizeResult = await awardSeasonPrizes(admin, {
    orgId,
    seasonId: previous.id,
    standings: standings.map((s) => ({
      student_id: s.student_id,
      sport: s.sport,
      division: s.division,
      points: s.points,
    })),
    promotions,
  })

  await admin.from('liga_seasons').update({ status: 'closed' }).eq('id', previous.id)

  const season = await getOrCreateActiveSeason(orgId, now)
  if (!season) return { closed: true, promoted, demoted, carried: 0, prizes: prizeResult.awarded }

  const carriedRows = standings.map((r) => ({
    organization_id: orgId,
    season_id: season.id,
    student_id: r.student_id,
    sport: r.sport,
    division: nextDivision.get(`${r.student_id}::${r.sport}`) ?? r.division,
    points: 0,
    streak_weeks: r.streak_weeks,
  }))

  if (carriedRows.length > 0) {
    await admin
      .from('liga_standings')
      .upsert(carriedRows, { onConflict: 'season_id,student_id,sport' })
  }

  return {
    closed: true,
    promoted,
    demoted,
    carried: carriedRows.length,
    prizes: prizeResult.awarded,
  }
}
