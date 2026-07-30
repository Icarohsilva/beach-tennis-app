// lib/checkin/monthlyProgress.ts
// Progresso da meta mensal de check-ins contado em DIAS DISTINTOS
// (spec 2026-07-29-checkin-diario-unico).
//
// Antes toda leitura contava LINHAS de `checkins`: quem fazia duas aulas na terça e
// nenhuma na quarta aparecia com 2 de progresso quando deveria aparecer com 1. O
// parceiro nunca é bloqueado por isso — ele entra nas duas aulas normalmente; só o
// primeiro check-in do dia conta pra meta.
//
// Fora daqui de propósito: features/financeiro/partnerRevenueActions.ts, que segue
// contando linha por linha. Quantos check-ins/dia o parceiro de fato reembolsa é uma
// decisão de negócio separada — mudar isso alteraria quanto a academia espera receber.
import type { createAdminClient } from '@/lib/supabase/server'
import type { DateWindow } from '@/lib/utils/monthWindow'

type AdminClient = ReturnType<typeof createAdminClient>

/** Dias distintos em linhas de check-in já buscadas. Puro, para reuso sem query nova. */
export function countDistinctDays(rows: { checkin_date: string }[]): number {
  return new Set(rows.map((r) => r.checkin_date)).size
}

/**
 * Quantos DIAS distintos o aluno fez check-in na janela, nesta academia.
 *
 * Substitui o `{ count: 'exact', head: true }` que existia nos callers: precisamos
 * das datas para deduplicar, então a contagem vem do array e não do banco.
 */
export async function countDistinctCheckinDays(
  client: AdminClient,
  studentId: string,
  orgId: string,
  window: DateWindow,
): Promise<number> {
  const { data } = await client
    .from('checkins')
    .select('checkin_date')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('checkin_date', window.from)
    .lte('checkin_date', window.to)

  return countDistinctDays((data ?? []) as { checkin_date: string }[])
}
