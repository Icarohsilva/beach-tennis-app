// lib/torneios/entryDiscount.ts

/**
 * Calcula o percentual de desconto para uma nova inscrição em torneio pago.
 * @param weeklyPaidCount - nº de entradas pagas/pendentes do jogador nesta semana ANTES desta
 * @param discount2Pct   - configuração da academia: desconto no 2º torneio
 * @param discount3Pct   - configuração da academia: desconto no 3º+ torneio
 */
export function computeEntryDiscount(
  weeklyPaidCount: number,
  discount2Pct: number,
  discount3Pct: number,
): number {
  if (weeklyPaidCount <= 0) return 0
  if (weeklyPaidCount === 1) return discount2Pct
  return discount3Pct
}

/**
 * Aplica um percentual de desconto a um preço em centavos.
 * Resultado arredondado para o inteiro mais próximo.
 */
export function applyDiscount(priceCents: number, discountPct: number): number {
  return Math.round(priceCents * (100 - discountPct) / 100)
}
