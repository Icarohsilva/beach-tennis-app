// lib/billing/fees.ts
// Comissão da plataforma sobre pagamentos das academias (marketplace_fee do
// MP). organizations.platform_fee_pct = 0 no lançamento; qualquer entrada
// inválida resulta em 0 — na dúvida, NÃO cobrar comissão.
export function computeMarketplaceFee(amount: number, feePct: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(feePct)) return 0
  if (amount <= 0 || feePct <= 0 || feePct > 100) return 0
  return Math.round(amount * feePct) / 100
}
