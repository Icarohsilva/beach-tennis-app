// lib/wallet/wallet.ts
// Regras puras do crédito em dinheiro (carteira). Sem I/O.
//
// A divisão "quanto sai do saldo, quanto vai para o cartão" mora aqui porque
// três telas de compra (day use, créditos de aula, inscrição de torneio) têm de
// MOSTRAR a mesma divisão que a cobrança aplica. Calculada em dois lugares, a
// tela promete um desconto e o Mercado Pago cobra outro.

/** Quanto do total o saldo cobre e quanto ainda vai ao gateway. */
export interface WalletSplit {
  /** Centavos a debitar da carteira. */
  walletCents: number
  /** Centavos que sobram para o cartão/PIX do gateway. */
  gatewayCents: number
}

/**
 * Divide um total entre saldo e gateway.
 *
 * Trabalha só em centavos inteiros: reais em float dividem R$ 39,90 em
 * 39.900000000000006 e o resto do sistema já é centavo inteiro
 * (`dayuse_slots.price_cents`, `tournaments.entry_price_cents`).
 *
 * Saldo maior que o total NÃO gera troco nem cobrança negativa: debita só o
 * total e deixa o resto na carteira.
 */
export function splitWithWallet(totalCents: number, balanceCents: number): WalletSplit {
  const total = Math.max(0, Math.round(totalCents))
  const balance = Math.max(0, Math.round(balanceCents))
  const walletCents = Math.min(total, balance)
  return { walletCents, gatewayCents: total - walletCents }
}

/** O saldo cobre a compra inteira? Então não há checkout a abrir. */
export function walletCoversAll(totalCents: number, balanceCents: number): boolean {
  const { gatewayCents } = splitWithWallet(totalCents, balanceCents)
  return gatewayCents === 0
}

export const WALLET_REASONS = {
  dayuseRefund: 'dayuse_refund',
  dayuseBooking: 'dayuse_booking',
  classCredits: 'class_credits',
  tournamentEntry: 'tournament_entry',
  adminAdjust: 'admin_adjust',
} as const

export type WalletReason = (typeof WALLET_REASONS)[keyof typeof WALLET_REASONS]

const REASON_LABEL: Record<string, string> = {
  dayuse_refund: 'Estorno de day use',
  dayuse_booking: 'Reserva de day use',
  class_credits: 'Compra de créditos de aula',
  tournament_entry: 'Inscrição de torneio',
  admin_adjust: 'Ajuste da academia',
}

/**
 * Rótulo do lançamento no extrato.
 *
 * Motivo desconhecido cai num texto genérico em vez de mostrar o slug cru: o
 * extrato é lido pelo aluno, e `dayuse_refund` não é português.
 */
export function walletReasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? 'Movimentação'
}

/** `R$ 40,00`, no mesmo formato de formatDayUsePrice. */
export function formatWalletCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}R$ ${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`
}
