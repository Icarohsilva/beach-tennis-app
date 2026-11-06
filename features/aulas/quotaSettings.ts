// features/aulas/quotaSettings.ts
// Chaves de system_settings da cota. Mesmo padrão de getDebtGraceDays
// (features/financeiro/debtQueries.ts:12).
import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

const DEFAULT_MAX_PER_DAY = 2

async function readSetting(
  client: AdminClient, orgId: string, key: string,
): Promise<string | null> {
  const { data } = await client
    .from('system_settings')
    .select('value')
    .eq('organization_id', orgId)
    .eq('key', key)
    .maybeSingle()
  return (data as { value: string } | null)?.value ?? null
}

/** A cota nasce desligada; a academia liga quando revisar seus planos. */
export async function isQuotaEnforced(client: AdminClient, orgId: string): Promise<boolean> {
  return (await readSetting(client, orgId, 'quota_enforcement_enabled')) === 'true'
}

/**
 * Teto diário de quem NÃO tem plano. Quem tem, usa o do plano.
 *
 * **0 é um valor válido e significa "sem limite"** — é assim que a academia
 * desliga a regra. Só a ausência da chave (ou lixo não numérico) cai no default;
 * antes o `> 0` transformava o 0 gravado pelo admin em 2, e não havia como dizer
 * "pode fazer quantas aulas quiser no dia".
 */
export async function getOrgMaxClassesPerDay(
  client: AdminClient, orgId: string,
): Promise<number> {
  const raw = await readSetting(client, orgId, 'max_classes_per_day')
  if (raw === null || raw.trim() === '') return DEFAULT_MAX_PER_DAY
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_PER_DAY
}

/** Chave de "sem plano e sem crédito pode agendar e pagar depois". */
export const PAY_LATER_SETTING = 'pay_later_booking_enabled'

/**
 * A academia deixa quem não tem plano nem crédito agendar e pagar depois?
 * Ausência da chave = sim: é o comportamento de antes da chave existir, e
 * desligar por padrão travaria o agendamento de toda academia que cobra a
 * avulsa depois da aula.
 */
export async function isPayLaterAllowed(client: AdminClient, orgId: string): Promise<boolean> {
  return (await readSetting(client, orgId, PAY_LATER_SETTING)) !== 'false'
}
