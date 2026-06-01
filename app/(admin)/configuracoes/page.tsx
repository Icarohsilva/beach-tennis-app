// app/(admin)/configuracoes/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { SystemSettingsForm } from './SystemSettingsForm'

interface SystemSettings {
  credit_expiry_days: number
  cancellation_window_hours: number
}

export default async function ConfiguracoesPage() {
  const adminClient = createAdminClient()

  const { data: settings } = await adminClient
    .from('system_settings')
    .select('credit_expiry_days, cancellation_window_hours')
    .maybeSingle()

  const defaults: SystemSettings = {
    credit_expiry_days: settings?.credit_expiry_days ?? 30,
    cancellation_window_hours: settings?.cancellation_window_hours ?? 5,
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-white">Configurações</h1>
        <p className="text-slate-400 text-sm mt-1">Parâmetros globais do sistema</p>
      </div>
      <SystemSettingsForm settings={defaults} />
    </div>
  )
}
