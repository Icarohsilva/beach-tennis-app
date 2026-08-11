// features/liga/settings.ts
// Configuração da Liga por academia, em system_settings (key/value), mesmo mecanismo
// de video_feed_url e dos pesos de crédito.
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_LIGA_WEIGHTS, type LigaWeights } from '@/lib/liga/points'
import {
  DEFAULT_DIVISION_CUTS,
  DIVISION_ORDER,
  type DemoteMode,
  type Division,
  type DivisionCuts,
} from '@/lib/liga/divisions'

export interface LigaSettings {
  enabled: boolean
  weights: LigaWeights
  /** Quantos sobem e quantos descem, divisão a divisão. */
  cuts: DivisionCuts
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
  cuts: DEFAULT_DIVISION_CUTS,
  kudosWeeklyCap: 3,
  // Receber vale mais que dar, de propósito: é a trava mais importante das quatro,
  // porque alinha o incentivo com SER elogiável em vez de distribuir elogio.
  kudosPointsGiven: 5,
  kudosPointsReceived: 15,
}

/** Chaves de system_settings do corte de uma divisão. */
export function promoteKey(division: Division): string {
  return `liga_promote_${division}`
}
export function demoteKey(division: Division): string {
  return `liga_demote_${division}`
}
export function demoteModeKey(division: Division): string {
  return `liga_demote_mode_${division}`
}

function intOr(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

function modeOr(value: string | undefined, fallback: DemoteMode): DemoteMode {
  return value === 'ultimos' || value === 'permanecem' ? value : fallback
}

/**
 * Monta os cortes divisão a divisão.
 *
 * A cadeia de fallback é chave da divisão → chave global antiga → padrão. As chaves
 * globais (`liga_promote_count` / `liga_demote_count`) são de quando o corte era um
 * número só para a escada inteira: quem já tinha configurado continua com o mesmo
 * comportamento até abrir as Configurações e distribuir os cortes por divisão.
 */
function readCuts(map: Map<string, string>): DivisionCuts {
  const legacyPromote = map.get('liga_promote_count')
  const legacyDemote = map.get('liga_demote_count')

  const cuts = {} as DivisionCuts
  for (const division of DIVISION_ORDER) {
    const padrao = DEFAULT_DIVISION_CUTS[division]
    cuts[division] = {
      promote: intOr(
        map.get(promoteKey(division)) ?? legacyPromote,
        padrao.promote,
      ),
      demoteMode: modeOr(map.get(demoteModeKey(division)), padrao.demoteMode),
      demote: intOr(map.get(demoteKey(division)) ?? legacyDemote, padrao.demote),
    }
  }
  return cuts
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
    cuts: readCuts(map),
    kudosWeeklyCap: intOr(map.get('liga_kudos_weekly_cap'), d.kudosWeeklyCap),
    kudosPointsGiven: intOr(map.get('liga_points_kudos_given'), d.kudosPointsGiven),
    kudosPointsReceived: intOr(map.get('liga_points_kudos_received'), d.kudosPointsReceived),
  }
}
