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
}

export const DEFAULT_LIGA_SETTINGS: LigaSettings = {
  // Nasce DESLIGADA de propósito: academia que não preencheu a modalidade das turmas
  // veria um ranking quase vazio. O dono liga quando estiver pronto.
  enabled: false,
  weights: DEFAULT_LIGA_WEIGHTS,
  promoteCount: 5,
  demoteCount: 3,
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
    },
    promoteCount: intOr(map.get('liga_promote_count'), d.promoteCount),
    demoteCount: intOr(map.get('liga_demote_count'), d.demoteCount),
  }
}
