import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { SystemSettingsForm } from './SystemSettingsForm'
import { GridAutoForm } from './GridAutoForm'
import { CobrancaForm } from './CobrancaForm'
import { VitrineForm } from './VitrineForm'
import { BrandingForm } from './BrandingForm'
import { TournamentDiscountForm } from './TournamentDiscountForm'
import { VideoFeedUrlForm } from './VideoFeedUrlForm'
import { LigaSettingsForm } from './LigaSettingsForm'
import { getLigaSettings } from '@/features/liga/settings'
import { SelfCheckinForm } from './SelfCheckinForm'
import { RequestDeletionButton } from '@/features/account/RequestDeletionButton'

import { DEFAULT_CHECKIN_TARGET } from '@/lib/checkin/orgCheckinTarget'
import { DEFAULT_CHECKIN_RADIUS_M } from '@/lib/checkin/selfCheckin'
import { requirePlatformAccess } from '@/lib/billing/guard'

interface SystemSettings {
  credit_expiry_days: number
  cancellation_window_hours: number
  default_checkin_target: number
  quota_enforcement_enabled: boolean
  max_classes_per_day: number
}

export default async function ConfiguracoesPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: rows } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)

  const map = new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

  const defaults: SystemSettings = {
    credit_expiry_days: Number(map.get('credit_expiry_days') ?? 30),
    cancellation_window_hours: Number(map.get('cancellation_window_hours') ?? 5),
    default_checkin_target: Number(map.get('default_checkin_target') ?? DEFAULT_CHECKIN_TARGET),
    quota_enforcement_enabled: map.get('quota_enforcement_enabled') === 'true',
    max_classes_per_day: Number(map.get('max_classes_per_day') ?? 2),
  }

  const gridAuto = {
    grid_auto_enabled: (map.get('grid_auto_enabled') ?? 'false') === 'true',
    grid_auto_day: Number(map.get('grid_auto_day') ?? 1),
    grid_auto_hour: Number(map.get('grid_auto_hour') ?? 6),
  }

  const cobranca = {
    pix_key: map.get('pix_key') ?? '',
    pix_key_owner: map.get('pix_key_owner') ?? '',
    debt_block_grace_days: Number(map.get('debt_block_grace_days') ?? 7),
  }

  const videoFeedUrl = map.get('video_feed_url') ?? ''

  // A config da Liga sai de getLigaSettings, e não do `map` acima, porque a cadeia de
  // fallback dos cortes por divisão (chave da divisão → chave global antiga → padrão)
  // mora lá. Reproduzi-la aqui faria o formulário mostrar um número e o fechamento da
  // temporada usar outro.
  const l = await getLigaSettings(orgId)
  const liga = {
    liga_enabled: l.enabled,
    liga_points_attendance: l.weights.attendance,
    liga_points_streak_week: l.weights.streakWeek,
    liga_points_tournament_entry: l.weights.tournamentEntry,
    liga_points_tournament_win: l.weights.tournamentWin,
    liga_kudos_weekly_cap: l.kudosWeeklyCap,
    liga_points_kudos_given: l.kudosPointsGiven,
    liga_points_kudos_received: l.kudosPointsReceived,
    liga_points_self_checkin: l.weights.selfCheckin,
    liga_points_cancel_in_time: l.weights.cancelInTime,
    liga_points_waitlist_accept: l.weights.waitlistAccept,
    liga_points_early_booking: l.weights.earlyBooking,
    liga_points_profile_complete: l.weights.profileComplete,
    liga_points_dayuse: l.weights.dayUse,
    cuts: l.cuts,
  }

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name, brand_color, logo_url, is_listed, cep, state, city, neighborhood, address_line, address_number, no_number, sports, whatsapp, instagram, tournament_discount_2_pct, tournament_discount_3_pct, self_checkin_enabled, latitude, longitude, checkin_radius_m')
    .eq('id', orgId)
    .single()

  const org = (orgRow ?? {}) as {
    name?: string | null
    brand_color?: string | null
    logo_url?: string | null
    is_listed?: boolean
    cep?: string | null
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    address_number?: string | null
    no_number?: boolean
    sports?: string[] | null
    whatsapp?: string | null
    instagram?: string | null
    tournament_discount_2_pct?: number | null
    tournament_discount_3_pct?: number | null
    self_checkin_enabled?: boolean
    latitude?: number | string | null
    longitude?: number | string | null
    checkin_radius_m?: number | null
  }

  const selfCheckin = {
    enabled: org.self_checkin_enabled ?? false,
    latitude: org.latitude === null || org.latitude === undefined ? null : Number(org.latitude),
    longitude: org.longitude === null || org.longitude === undefined ? null : Number(org.longitude),
    radiusM: org.checkin_radius_m ?? DEFAULT_CHECKIN_RADIUS_M,
  }

  const listing = {
    is_listed: org.is_listed ?? true,
    cep: org.cep ?? '',
    state: org.state ?? '',
    city: org.city ?? '',
    neighborhood: org.neighborhood ?? '',
    address_line: org.address_line ?? '',
    address_number: org.address_number ?? '',
    no_number: org.no_number ?? false,
    sports: org.sports ?? [],
    whatsapp: org.whatsapp ?? '',
    instagram: org.instagram ?? '',
  }

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-slate-400 text-sm mt-1">Parâmetros globais do sistema</p>
      </div>
      <SystemSettingsForm settings={defaults} />

      <div>
        <h2 className="text-lg font-bold text-white">Geração automática da grade</h2>
        <p className="text-slate-400 text-sm mt-1">
          Gere a grade da próxima semana automaticamente, no dia e hora que escolher.
        </p>
      </div>
      <GridAutoForm settings={gridAuto} />

      <div>
        <h2 className="text-lg font-bold text-white">Cobrança de aulas avulsas</h2>
        <p className="text-slate-400 text-sm mt-1">
          Chave PIX para o aluno pagar aulas em aberto e a carência antes de bloquear novos agendamentos.
        </p>
      </div>
      <CobrancaForm settings={cobranca} />

      <div>
        <h2 className="text-lg font-bold text-white">Confirmação de presença pelo aluno</h2>
        <p className="text-slate-400 text-sm mt-1">
          O aluno confirma presença pelo app perto do horário da aula, e o app confere a
          localização dele com a da academia.
        </p>
      </div>
      <SelfCheckinForm settings={selfCheckin} />

      <div>
        <h2 className="text-lg font-bold text-white">Vídeo das quadras</h2>
        <p className="text-slate-400 text-sm mt-1">
          URL do site de câmeras/gravações que os alunos acessam dentro da aba Liga.
        </p>
      </div>
      <VideoFeedUrlForm videoFeedUrl={videoFeedUrl} />

      <div>
        <h2 className="text-lg font-bold text-white">Liga</h2>
        <p className="text-slate-400 text-sm mt-1">
          Ranking de temporada por modalidade: quanto vale cada coisa e qual o corte de cada
          divisão no fim do mês.
        </p>
      </div>
      <LigaSettingsForm settings={liga} />

      <div>
        <h2 className="text-lg font-bold text-white">Personalização</h2>
        <p className="text-slate-400 text-sm mt-1">
          Logo e cor da sua academia nas telas do app, painel e página pública.
        </p>
      </div>
      <BrandingForm
        brandColor={org.brand_color ?? null}
        logoUrl={org.logo_url ?? null}
        orgName={org.name ?? 'Sua Academia'}
      />

      <div>
        <h2 className="text-lg font-bold text-white">Vitrine pública</h2>
        <p className="text-slate-400 text-sm mt-1">
          Como sua arena aparece no diretório público para novos alunos.
        </p>
      </div>
      <VitrineForm listing={listing} />

      <div>
        <h2 className="text-lg font-bold text-white">Torneios</h2>
        <p className="text-slate-400 text-sm mt-1">
          Desconto progressivo para inscrições múltiplas na mesma semana.
        </p>
      </div>
      <TournamentDiscountForm
        discount2Pct={org.tournament_discount_2_pct ?? 30}
        discount3Pct={org.tournament_discount_3_pct ?? 50}
      />

      <div>
        <h2 className="text-lg font-bold text-white">Zona de risco</h2>
        <p className="text-slate-400 text-sm mt-1">
          Solicitar exclusão encerra sua conta de dono. Nosso time entra em contato antes de
          processar.
        </p>
      </div>
      <div className="bg-surface-card border border-red-900/30 rounded-xl p-4">
        <RequestDeletionButton />
      </div>
    </div>
  )
}
