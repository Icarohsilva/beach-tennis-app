// features/liga/settings.ts
// Configuração da Liga por academia, em system_settings (key/value), mesmo mecanismo
// de video_feed_url e dos pesos de crédito.
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_LIGA_WEIGHTS, type LigaWeights } from '@/lib/liga/points'

export interface LigaSettings {
  enabled: boolean
  weights: LigaWeights
  promoteCount: number
  demoteCount: number
  /** Quantos elogios por semana ainda pontuam para quem envia (trava anti-farming). */
  kudosWeeklyCap: number
  kudosPointsGiven: number
  kudosPointsReceived: number
}

export const DEFAULT_LIGA_SETTINGS: LigaSettings = {
  // Nasce DESLIGADA de propósito: academia que não preencheu a modalidade das turmas
  // veria um ranking quase vazio. O dono liga quando estiver pronto.
  enabled: false,
  weights: DEFAULT_LIGA_WEIGHTS,
  promoteCount: 5,
  demoteCount: 3,
  kudosWeeklyCap: 3,
  // Receber vale mais que dar, de propósito: é a trava mais importante das quatro,
  // porque alinha o incentivo com SER elogiável em vez de distribuir elogio.
  kudosPointsGiven: 5,
  kudosPointsReceived: 15,
}

function intOr(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

/** Lê a config da Liga de uma academia. Chaves ausentes caem no default. */
export async function getLigaSettings(orgId: string | null | undefined): Promise<LigaSettings> {
  if (!orgId) return DEFAULT_LIGA_SETTINGS

  const admin = createAdminClient()
  const { data } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)

  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  const d = DEFAULT_LIGA_SETTINGS

  return {
    enabled: map.get('liga_enabled') === 'true',
    weights: {
      attendance: intOr(map.get('liga_points_attendance'), d.weights.attendance),
      streakWeek: intOr(map.get('liga_points_streak_week'), d.weights.streakWeek),
      tournamentEntry: intOr(map.get('liga_points_tournament_entry'), d.weights.tournamentEntry),
      tournamentWin: intOr(map.get('liga_points_tournament_win'), d.weights.tournamentWin),
      selfCheckin: intOr(map.get('liga_points_self_checkin'), d.weights.selfCheckin),
      cancelInTime: intOr(map.get('liga_points_cancel_in_time'), d.weights.cancelInTime),
      waitlistAccept: intOr(map.get('liga_points_waitlist_accept'), d.weights.waitlistAccept),
      earlyBooking: intOr(map.get('liga_points_early_booking'), d.weights.earlyBooking),
      profileComplete: intOr(map.get('liga_points_profile_complete'), d.weights.profileComplete),
      dayUse: intOr(map.get('liga_points_dayuse'), d.weights.dayUse),
    },
    promoteCount: intOr(map.get('liga_promote_count'), d.promoteCount),
    demoteCount: intOr(map.get('liga_demote_count'), d.demoteCount),
    kudosWeeklyCap: intOr(map.get('liga_kudos_weekly_cap'), d.kudosWeeklyCap),
    kudosPointsGiven: intOr(map.get('liga_points_kudos_given'), d.kudosPointsGiven),
    kudosPointsReceived: intOr(map.get('liga_points_kudos_received'), d.kudosPointsReceived),
  }
}
