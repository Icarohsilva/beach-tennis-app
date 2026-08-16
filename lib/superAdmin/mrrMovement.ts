// lib/superAdmin/mrrMovement.ts
// Movimento de MRR mês a mês — novo, reativação, expansão, contração e churn —
// derivado do histórico de transições (platform_subscription_events).
//
// Puro, sem I/O. A classificação NÃO vem de um campo "tipo de evento" gravado
// no banco: vem da diferença entre eventos consecutivos da MESMA org. Isso
// evita que quem grava o evento precise saber classificar (e errar), e faz
// expansão/contração funcionarem sozinhas no dia em que existir mais de um
// plano — hoje, com preço único, essas duas linhas são sempre zero.

export interface SubscriptionEvent {
  organizationId: string
  toStatus: string
  /** MRR da conta DEPOIS do evento, em centavos. */
  mrrCents: number
  occurredAt: string
  source: string
}

export interface MrrMovementRow {
  month: string
  label: string
  /** Primeira vez que a conta passa a pagar. */
  novoCents: number
  /** Conta que já pagou antes, parou e voltou. */
  reativacaoCents: number
  /** Conta pagante que passou a pagar mais. */
  expansaoCents: number
  /** Conta pagante que passou a pagar menos (sem zerar). */
  contracaoCents: number
  /** Conta que parou de pagar. Negativo. */
  churnCents: number
  /** Soma dos cinco acima. */
  liquidoCents: number
  /** MRR total da plataforma no fim do mês. */
  mrrFinalCents: number
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`
}

/**
 * Série mensal de movimento. `events` pode vir em qualquer ordem — a função
 * ordena por org e data antes de derivar os deltas.
 *
 * Linhas com `source: 'seed'` são o marco zero da adoção do histórico: definem
 * o MRR de partida da conta, mas NÃO contam como movimento (não foi venda nem
 * cancelamento, foi o dia em que passamos a medir).
 */
export function mrrMovement(
  events: SubscriptionEvent[],
  months: number,
  now: Date,
): MrrMovementRow[] {
  const rows: MrrMovementRow[] = []
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(monthKey(d))
    rows.push({
      month: monthKey(d),
      label: monthLabel(d),
      novoCents: 0,
      reativacaoCents: 0,
      expansaoCents: 0,
      contracaoCents: 0,
      churnCents: 0,
      liquidoCents: 0,
      mrrFinalCents: 0,
    })
  }
  const byMonth = new Map(rows.map((r) => [r.month, r]))

  // Agrupa por org e ordena no tempo — o delta só faz sentido dentro da conta.
  const perOrg = new Map<string, SubscriptionEvent[]>()
  for (const e of events) {
    const list = perOrg.get(e.organizationId)
    if (list) list.push(e)
    else perOrg.set(e.organizationId, [e])
  }

  // MRR de cada org ao fim de cada mês da janela, para o total de fechamento.
  const mrrAtMonthEnd = new Map<string, number>()

  perOrg.forEach((list) => {
    list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

    let prev = 0
    let jaPagouAntes = false
    // Percorre os meses da janela junto com os eventos para saber o saldo da
    // conta no fechamento de cada mês, inclusive nos meses sem evento nenhum.
    let cursor = 0

    for (const key of keys) {
      // Consome todos os eventos que caem neste mês ou antes dele.
      while (cursor < list.length && monthKey(new Date(list[cursor].occurredAt)) <= key) {
        const e = list[cursor]
        const atual = e.mrrCents
        const row = byMonth.get(monthKey(new Date(e.occurredAt)))

        // Seed só estabelece a linha de base; não é movimento.
        if (row && e.source !== 'seed' && atual !== prev) {
          if (prev === 0 && atual > 0) {
            if (jaPagouAntes) row.reativacaoCents += atual
            else row.novoCents += atual
          } else if (prev > 0 && atual === 0) {
            row.churnCents -= prev
          } else if (atual > prev) {
            row.expansaoCents += atual - prev
          } else {
            row.contracaoCents -= prev - atual
          }
        }

        if (atual > 0) jaPagouAntes = true
        prev = atual
        cursor++
      }
      mrrAtMonthEnd.set(key, (mrrAtMonthEnd.get(key) ?? 0) + prev)
    }
  })

  for (const r of rows) {
    r.liquidoCents =
      r.novoCents + r.reativacaoCents + r.expansaoCents + r.contracaoCents + r.churnCents
    r.mrrFinalCents = mrrAtMonthEnd.get(r.month) ?? 0
  }
  return rows
}

/** Data do primeiro evento — o painel diz desde quando está medindo. */
export function measuringSince(events: SubscriptionEvent[]): string | null {
  let earliest: string | null = null
  for (const e of events) {
    if (!earliest || e.occurredAt < earliest) earliest = e.occurredAt
  }
  return earliest
}

/** Centavos → reais, para as funções de formatação já existentes. */
export function centsToBRL(cents: number): number {
  return cents / 100
}
