// lib/notifications/lowCredit.ts
/**
 * Decide se o cruzamento de saldo deve disparar o aviso de "credito baixo".
 * Dispara SÓ quando o saldo passou de >1 para exatamente 1 neste debito. Se já
 * estava em 1 ou 0 (ou o saldo subiu), não repete.
 */
export function shouldNotifyLowCredit(oldBalance: number, newBalance: number): boolean {
  return oldBalance > 1 && newBalance === 1
}
