// lib/torneios/prizes.ts
// Premiação: o que o competidor GANHA (tabela tournament_prizes, migração
// 20260826000600). Regra pura sobre a lista já lida do banco.
export interface PrizeRow {
  id: string
  kind: 'podium' | 'special'
  position: number | null
  description: string
  value_cents: number | null
  delivered_at: string | null
}

const POSITION_LABELS: Record<number, string> = {
  1: 'Campeão',
  2: 'Vice',
  3: '3º lugar',
}

/** 'Campeão' / 'Vice' / '3º lugar' / 'Nº lugar' para colocações sem nome especial. */
export function positionLabel(position: number): string {
  return POSITION_LABELS[position] ?? `${position}º lugar`
}

/** Pódio em ordem de colocação, depois os prêmios especiais. */
export function sortPrizes(rows: readonly PrizeRow[]): PrizeRow[] {
  const podium = rows.filter((r) => r.kind === 'podium').sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const special = rows.filter((r) => r.kind === 'special')
  return [...podium, ...special]
}

/** Soma só o que tem valor em dinheiro — prêmio em texto (troféu, kit) não conta e não vira NaN. */
export function totalPrizeCents(rows: readonly PrizeRow[]): number {
  return rows.reduce((sum, r) => sum + (r.value_cents ?? 0), 0)
}

/** O prêmio do pódio numa colocação — é o que casa com winner1_id/winner2_id/winner3_id. */
export function prizeForPosition(rows: readonly PrizeRow[], position: number): PrizeRow | null {
  return rows.find((r) => r.kind === 'podium' && r.position === position) ?? null
}

/** Prêmios ainda não marcados como entregues. */
export function pendingDelivery(rows: readonly PrizeRow[]): PrizeRow[] {
  return rows.filter((r) => r.delivered_at === null)
}
