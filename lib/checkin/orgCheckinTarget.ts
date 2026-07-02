// lib/checkin/orgCheckinTarget.ts
// Meta mensal de check-ins padrão da academia. Fica em system_settings (key/value
// por org, chave 'default_checkin_target'). É o valor que o sistema usa ao vincular
// um aluno a um parceiro sem meta própria; o admin pode sobrescrever por aluno.
import { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

export const DEFAULT_CHECKIN_TARGET = 12
export const CHECKIN_TARGET_KEY = 'default_checkin_target'

export async function getOrgDefaultCheckinTarget(
  client: AdminClient,
  orgId: string,
): Promise<number> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', CHECKIN_TARGET_KEY)
    .maybeSingle()

  const parsed = Number(data?.value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_CHECKIN_TARGET
}
