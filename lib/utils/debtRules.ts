// lib/utils/debtRules.ts
// Puro: decide o que bloqueia e resume a dívida do aluno (spec 2026-07-22 §2).
// Bloqueio exige TRÊS coisas — ter valor, ter passado a carência, e a pendência
// ser de aula. O filtro por aula (session_id) fica na query; aqui entram só as
// linhas já filtradas.

export interface DebtRow {
  id: string
  amount: number
  createdAt: string // ISO
  receiptUrl: string | null
}

export interface DebtSummary {
  total: number
  count: number
  oldestAt: string | null
  isBlocked: boolean
  /** Quantas já têm comprovante aguardando conferência do admin. */
  awaitingReview: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Uma pendência bloqueia quando tem valor E já passou a carência.
 *
 * `amount > 0` conserta um furo real: ensureClassDebt grava amount 0 quando a
 * academia não configurou single_class_price — como o bloqueio olhava só
 * existência, essas dívidas de R$ 0 travavam o aluno para sempre.
 *
 * Comprovante enviado NÃO desbloqueia (decisão do usuário): só a baixa do admin.
 */
export function isBlockingDebt(debt: DebtRow, graceDays: number, now: Date): boolean {
  if (debt.amount <= 0) return false
  const graceEndsAt = new Date(debt.createdAt).getTime() + graceDays * DAY_MS
  return now.getTime() >= graceEndsAt
}

export function summarizeDebts(debts: DebtRow[], graceDays: number, now: Date): DebtSummary {
  if (debts.length === 0) {
    return { total: 0, count: 0, oldestAt: null, isBlocked: false, awaitingReview: 0 }
  }
  let total = 0
  let oldestAt: string | null = null
  let isBlocked = false
  let awaitingReview = 0
  for (const d of debts) {
    total += d.amount
    if (oldestAt === null || d.createdAt < oldestAt) oldestAt = d.createdAt
    if (isBlockingDebt(d, graceDays, now)) isBlocked = true
    if (d.receiptUrl) awaitingReview++
  }
  return { total: Math.round(total * 100) / 100, count: debts.length, oldestAt, isBlocked, awaitingReview }
}
