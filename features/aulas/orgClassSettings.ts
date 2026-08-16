// features/aulas/orgClassSettings.ts
// As chaves de system_settings que governam entrar e sair de aula.
//
// Existe por dois motivos. O primeiro é o modal de regras, que precisa de mais de
// uma chave de uma vez e não deve pagar uma consulta por linha de texto.
//
// O segundo é um conserto: `cancellation_window_hours` estava em
// system_settings, aparecia em Configurações e o admin editava — mas NADA lia.
// Os dois pontos que decidem o estorno chamavam `canCancelWithRefund` sem passar
// o valor, e o default de 5h sempre vencia. A academia que gravou 3h achou que
// tinha mudado a regra por meses.
import type { createAdminClient } from '@/lib/supabase/server'
import { CANCELLATION_WINDOW_HOURS } from '@/lib/utils/creditRules'

type AdminClient = ReturnType<typeof createAdminClient>

/** Validade do crédito de reposição quando a academia não configurou. */
const DEFAULT_CREDIT_EXPIRY_DAYS = 30

export interface OrgClassSettings {
  /** Antecedência mínima para cancelar sem perder a aula. */
  cancellationWindowHours: number
  /** Validade do crédito de reposição, em dias. Só ele expira. */
  creditExpiryDays: number
}

/**
 * As duas chaves numa consulta só.
 *
 * Valor ausente, vazio ou não-numérico cai no default — o mesmo cuidado de
 * `getOrgMaxClassesPerDay`. Zero e negativo também caem: janela de cancelamento
 * 0 significaria "pode cancelar em cima da hora e levar a aula de volta", que
 * nenhuma academia configura de propósito e que o formulário nem aceita.
 */
export async function getOrgClassSettings(
  client: AdminClient,
  orgId: string,
): Promise<OrgClassSettings> {
  const { data } = await client
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['cancellation_window_hours', 'credit_expiry_days'])

  const byKey = new Map(
    ((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  )

  return {
    cancellationWindowHours: positiveOr(
      byKey.get('cancellation_window_hours'),
      CANCELLATION_WINDOW_HOURS,
    ),
    creditExpiryDays: positiveOr(byKey.get('credit_expiry_days'), DEFAULT_CREDIT_EXPIRY_DAYS),
  }
}

function positiveOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
