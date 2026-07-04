// lib/billing/fees.ts
// Comissão da plataforma sobre pagamentos das academias (marketplace_fee do
// MP). organizations.platform_fee_pct = 0 no lançamento; qualquer entrada
// inválida resulta em 0 — na dúvida, NÃO cobrar comissão.
export function computeMarketplaceFee(amount: number, feePct: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(feePct)) return 0
  if (amount <= 0 || feePct <= 0 || feePct > 100) return 0
  // toFixed(8) squash o ruído de ponto flutuante de amount*feePct antes de
  // arredondar para centavos — sem isso, ties exatos (ex.: 0.29*50=14.5)
  // caem como 14.499999999999998 e Math.round sempre arredonda pra baixo,
  // subcobrando a plataforma em 1 centavo em ~4% dos valores possíveis.
  return Math.round(Number((amount * feePct).toFixed(8))) / 100
}
