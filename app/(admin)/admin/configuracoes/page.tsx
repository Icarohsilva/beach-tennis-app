import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { SystemSettingsForm } from './SystemSettingsForm'
import { VitrineForm } from './VitrineForm'
import { BrandingForm } from './BrandingForm'
import { TournamentDiscountForm } from './TournamentDiscountForm'

import { DEFAULT_CHECKIN_TARGET } from '@/lib/checkin/orgCheckinTarget'

interface SystemSettings {
  credit_expiry_days: number
  cancellation_window_hours: number
  default_checkin_target: number
}

export default async function ConfiguracoesPage() {
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
  }

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name, brand_color, logo_url, is_listed, cep, state, city, neighborhood, address_line, address_number, no_number, sports, whatsapp, tournament_discount_2_pct, tournament_discount_3_pct')
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
    tournament_discount_2_pct?: number | null
    tournament_discount_3_pct?: number | null
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
  }

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-slate-400 text-sm mt-1">Parâmetros globais do sistema</p>
      </div>
      <SystemSettingsForm settings={defaults} />

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
    </div>
  )
}
