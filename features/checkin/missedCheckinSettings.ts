// features/checkin/missedCheckinSettings.ts
// Chaves de system_settings da pendência de check-in + a contagem de pendências
// abertas do aluno. Mesmo padrão de features/aulas/quotaSettings.ts.
import type { createAdminClient } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export const BLOCK_LIMIT_KEY = 'missed_checkin_block_limit'
export const PRICE_KEY = 'missed_checkin_price'

export interface MissedCheckinSettings {
  /** 0 = regra de bloqueio desligada. */
  blockLimit: number
  /** Reais por pendência. 0 = usa o repasse do parceiro (partner_checkin_rates). */
  price: number
}

/**
 * As duas configs numa query só — o caminho quente (toda reserva) precisa do limite,
 * e a chamada precisa dos dois.
 */
export async function getMissedCheckinSettings(
  client: AdminClient,
  orgId: string,
): Promise<MissedCheckinSettings> {
  const { data } = await client
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', [BLOCK_LIMIT_KEY, PRICE_KEY])

  const rows = (data ?? []) as { key: string; value: string }[]
  const byKey = new Map(rows.map((r) => [r.key, r.value]))

  const limit = Number(byKey.get(BLOCK_LIMIT_KEY))
  const price = parseFloat(byKey.get(PRICE_KEY) ?? '0')

  return {
    blockLimit: Number.isInteger(limit) && limit > 0 ? limit : 0,
    price: Number.isFinite(price) && price > 0 ? price : 0,
  }
}

/**
 * Valor a cobrar por uma pendência, em reais.
 *
 * Sem preço próprio configurado, cai no que a academia deixou de receber do parceiro
 * (`partner_checkin_rates.value`) — que é o prejuízo real da falta. Se nem isso
 * estiver configurado, retorna 0: a pendência nasce só como controle, sem cobrança
 * (mesma filosofia de `ensureClassDebt` quando `single_class_price` não existe).
 */
export async function resolveMissedCheckinAmount(
  client: AdminClient,
  orgId: string,
  partner: CheckinPartner,
): Promise<number> {
  const { price } = await getMissedCheckinSettings(client, orgId)
  if (price > 0) return price

  const { data } = await client
    .from('partner_checkin_rates')
    .select('value')
    .eq('organization_id', orgId)
    .eq('partner', partner)
    .maybeSingle()

  const rate = parseFloat(String((data as { value: number | string } | null)?.value ?? '0'))
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

/** Quantas pendências de check-in em aberto o aluno tem NESTA academia. */
export async function countOpenMissedCheckins(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<number> {
  const { count } = await client
    .from('missed_checkins')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'open')

  return count ?? 0
}

/**
 * Contagem de pendências abertas de VÁRIOS alunos, numa query. Para as telas e a
 * geração da grade, que decidem sobre a academia inteira e não podem fazer N queries.
 */
export async function countOpenMissedCheckinsByStudent(
  client: AdminClient,
  orgId: string,
  studentIds?: string[],
): Promise<Map<string, number>> {
  if (studentIds && studentIds.length === 0) return new Map()

  let query = client
    .from('missed_checkins')
    .select('student_id')
    .eq('organization_id', orgId)
    .eq('status', 'open')

  if (studentIds) query = query.in('student_id', studentIds)

  const { data } = await query
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as { student_id: string }[]) {
    counts.set(r.student_id, (counts.get(r.student_id) ?? 0) + 1)
  }
  return counts
}
