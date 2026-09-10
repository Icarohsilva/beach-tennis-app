// features/wallet/spendWallet.ts
// Embrulho da RPC `wallet_apply` — o ÚNICO caminho de escrita do saldo.
//
// Existe como função e não como chamada solta em cada action para que a
// tradução dos erros do banco ("INSUFFICIENT_BALANCE" → texto do aluno) e a
// compensação (devolver o que foi debitado quando o checkout seguinte falha)
// tenham uma forma só.
import type { createAdminClient } from '@/lib/supabase/server'
import { WALLET_REASONS, type WalletReason } from '@/lib/wallet/wallet'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WalletMoveInput {
  orgId: string
  studentId: string
  /** Centavos POSITIVOS. O sentido vem da função chamada, não do sinal. */
  cents: number
  reason: WalletReason
  /**
   * Origem do lançamento. Com ela a RPC fica idempotente (índice parcial
   * wallet_transactions_source_key): retry de action ou duplo clique não credita
   * nem debita duas vezes.
   */
  sourceTable?: string
  sourceId?: string
  createdBy?: string
}

export interface WalletMoveResult {
  error?: string
  /** Saldo depois do lançamento, para a tela não reler. */
  balanceCents?: number
}

async function apply(
  client: AdminClient,
  input: WalletMoveInput,
  signedCents: number,
): Promise<WalletMoveResult> {
  const { data, error } = await client.rpc('wallet_apply', {
    p_org: input.orgId,
    p_student: input.studentId,
    p_amount_cents: signedCents,
    p_reason: input.reason,
    p_source_table: input.sourceTable ?? null,
    p_source_id: input.sourceId ?? null,
    p_created_by: input.createdBy ?? null,
  })

  if (error) {
    if (error.message.includes('INSUFFICIENT_BALANCE')) {
      return { error: 'Seu saldo não cobre este valor.' }
    }
    if (error.message.includes('WALLET_ZERO_AMOUNT')) {
      // Chamada com zero é bug do caller, não situação do aluno.
      console.error('[wallet] lançamento de valor zero', input)
      return { error: 'Valor inválido.' }
    }
    console.error('[wallet] wallet_apply falhou', { ...input, error: error.message })
    return { error: 'Não foi possível movimentar seu saldo. Tente novamente.' }
  }

  return { balanceCents: Number(data) }
}

/** Credita (estorno escolhido como crédito, ajuste da academia). */
export function creditWallet(client: AdminClient, input: WalletMoveInput) {
  return apply(client, input, Math.abs(Math.round(input.cents)))
}

/** Debita (compra paga com saldo). Falha limpa quando o saldo não cobre. */
export function spendWallet(client: AdminClient, input: WalletMoveInput) {
  return apply(client, input, -Math.abs(Math.round(input.cents)))
}

/**
 * Devolve um débito que não virou compra (o checkout do resto falhou).
 *
 * A origem ganha o sufixo `:reversal` de propósito. O índice de idempotência é
 * (org, aluno, motivo, source_table, source_id) — devolver com a MESMA origem do
 * débito colidiria com ele, o `on conflict do nothing` da RPC engoliria a linha,
 * e o aluno ficaria sem o saldo e sem a compra. O sufixo também deixa o par
 * débito/devolução legível no extrato.
 */
export function refundWalletSpend(
  client: AdminClient,
  input: WalletMoveInput & { sourceTable: string; sourceId: string },
) {
  return creditWallet(client, { ...input, sourceTable: `${input.sourceTable}:reversal` })
}

export { WALLET_REASONS }
