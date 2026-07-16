export interface CreditTx {
  /** Positivo = concessão (lote). Negativo = consumo. */
  amount: number
  created_at: string
  /** Null = crédito que não expira (ex.: estorno de matrícula fixa). */
  expires_at: string | null
}

export interface CreditReplay {
  /** Saldo de créditos ainda válidos (não consumidos, não vencidos). */
  validBalance: number
  /** Créditos que venceram sem serem usados. */
  expiredAmount: number
}

interface Lot {
  remaining: number
  expiresAt: number | null
}

/**
 * Reprocessa o extrato em FIFO para descobrir quanto do saldo ainda vale e
 * quanto venceu sem uso. Necessário porque credits_balance é um int único e
 * credit_transactions não liga um débito ao lote que ele consumiu.
 *
 * Débitos consomem o lote mais antigo primeiro. Um lote vencido só entra em
 * expiredAmount se ainda tiver saldo no fim do replay.
 *
 * Puro: não toca no banco.
 */
export function replayCredits(transactions: CreditTx[], now: Date): CreditReplay {
  const nowMs = now.getTime()

  const chronological = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const lots: Lot[] = []

  for (const t of chronological) {
    if (t.amount > 0) {
      lots.push({
        remaining: t.amount,
        expiresAt: t.expires_at ? new Date(t.expires_at).getTime() : null,
      })
      continue
    }

    // Consumo: tira do lote mais antigo com saldo (FIFO).
    let toConsume = -t.amount
    for (const lot of lots) {
      if (toConsume === 0) break
      const taken = Math.min(lot.remaining, toConsume)
      lot.remaining -= taken
      toConsume -= taken
    }
  }

  let validBalance = 0
  let expiredAmount = 0
  for (const lot of lots) {
    if (lot.remaining === 0) continue
    const expired = lot.expiresAt !== null && lot.expiresAt < nowMs
    if (expired) expiredAmount += lot.remaining
    else validBalance += lot.remaining
  }

  return { validBalance, expiredAmount }
}
