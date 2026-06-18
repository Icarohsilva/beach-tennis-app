import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { SystemSettingsForm } from './SystemSettingsForm'
import { VitrineForm } from './VitrineForm'

interface SystemSettings {
  credit_expiry_days: number
  cancellation_window_hours: number
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
  }

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('is_listed, state, city, neighborhood, address_line, sports, whatsapp')
    .eq('id', orgId)
    .single()

  const org = (orgRow ?? {}) as {
    is_listed?: boolean
    state?: string | null
    city?: string | null
    neighborhood?: string | null
    address_line?: string | null
    sports?: string[] | null
    whatsapp?: string | null
  }

  const listing = {
    is_listed: org.is_listed ?? true,
    state: org.state ?? '',
    city: org.city ?? '',
    neighborhood: org.neighborhood ?? '',
    address_line: org.address_line ?? '',
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
        <h2 className="text-lg font-bold text-white">Vitrine pública</h2>
        <p className="text-slate-400 text-sm mt-1">
          Como sua arena aparece no diretório público para novos alunos.
        </p>
      </div>
      <VitrineForm listing={listing} />
    </div>
  )
}
