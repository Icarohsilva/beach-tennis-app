import { formatDate } from './dateHelpers'

export interface SessionLite {
  id: string
  session_date: string // yyyy-MM-dd
}

export interface ReconciliationOp {
  sessionId: string
  sessionDate: string
  needsCredit: boolean
  grantReason: string
  debitReason: string
}

/** Consome crédito quem NÃO tem parceiro. Parceiro (wellhub/totalpass) agenda via check-in. */
export function requiresCredit(partner: string | null): boolean {
  return !partner
}

/**
 * Extrai o parceiro a partir do payment_type da membership. Só wellhub/totalpass
 * são parceiros; 'subscriber'/'per_class' não têm parceiro (→ null).
 *
 * Ponte necessária porque payment_type é NOT NULL: passar payment_type direto a
 * requiresCredit faria todo aluno cair em "tem parceiro" (string truthy) e parar
 * de consumir crédito.
 */
export function partnerOf(paymentType: string | null): string | null {
  return paymentType === 'wellhub' || paymentType === 'totalpass' ? paymentType : null
}

/**
 * Para cada sessão ainda não reservada, monta a operação de reconciliação
 * (conceder + reservar + debitar). `needsCredit` é decidido pelo caller
 * (sem parceiro E com plano ativo). Puro: não toca no banco.
 */
export function buildReconciliationOps(
  sessions: SessionLite[],
  bookedSessionIds: Set<string>,
  needsCredit: boolean,
  planName: string,
): ReconciliationOp[] {
  return sessions
    .filter((s) => !bookedSessionIds.has(s.id))
    .map((s) => {
      // Parse yyyy-MM-dd as local date (not UTC)
      const [year, month, day] = s.session_date.split('-').map(Number)
      const localDate = new Date(year, month - 1, day)
      const ddmm = formatDate(localDate, 'dd/MM')
      return {
        sessionId: s.id,
        sessionDate: s.session_date,
        needsCredit,
        grantReason: `Plano ${planName} — aula ${ddmm}`,
        debitReason: `Matrícula fixa — aula ${ddmm}`,
      }
    })
}
