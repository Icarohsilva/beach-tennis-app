export interface SessionLite {
  id: string
  session_date: string // yyyy-MM-dd
}

export interface ReconciliationOp {
  sessionId: string
  sessionDate: string
}

/**
 * Para cada sessão ainda não reservada, monta a operação de reconciliação.
 * Puro: não toca no banco.
 *
 * Desde 2026-07 a matrícula fixa NÃO consome crédito: fixa exige plano ou
 * parceiro, e ambos entram de graça (spec §3). Por isso não há mais
 * needsCredit / grantReason / debitReason aqui.
 */
export function buildReconciliationOps(
  sessions: SessionLite[],
  bookedSessionIds: Set<string>,
): ReconciliationOp[] {
  return sessions
    .filter((s) => !bookedSessionIds.has(s.id))
    .map((s) => ({ sessionId: s.id, sessionDate: s.session_date }))
}
