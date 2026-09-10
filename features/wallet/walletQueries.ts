// features/wallet/walletQueries.ts
// Leitura do saldo e do extrato da carteira. Uma casa só porque quatro telas
// (financeiro do aluno, reserva de day use, compra de créditos, inscrição de
// torneio) precisam do mesmo número antes de mostrar preço.
import type { createAdminClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/supabase/paginate'

type AdminClient = ReturnType<typeof createAdminClient>
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export interface WalletEntry {
  id: string
  amount_cents: number
  reason: string
  created_at: string
}

/**
 * Saldo em centavos. Zero para quem nunca movimentou — a linha de `wallets` só
 * nasce no primeiro lançamento (wallet_apply), então ausência é saldo zero, não
 * erro.
 */
export async function getWalletBalance(
  client: AdminClient,
  orgId: string,
  studentId: string,
): Promise<number> {
  const { data } = await client
    .from('wallets')
    .select('balance_cents')
    .eq('organization_id', orgId)
    .eq('student_id', studentId)
    .maybeSingle()
  return Number((data as { balance_cents: number } | null)?.balance_cents ?? 0)
}

/**
 * Extrato do aluno naquela academia, do mais recente para o mais antigo.
 *
 * Paginado: o extrato cresce com o uso e um aluno de anos de casa passa do teto
 * de 1.000 linhas do PostgREST — que corta em silêncio (ver lib/supabase/paginate.ts).
 */
export async function getWalletStatement(
  client: AdminClient,
  orgId: string,
  studentId: string,
): Promise<WalletEntry[]> {
  return fetchAllPages<WalletEntry>(
    (from, to) =>
      client
        .from('wallet_transactions')
        .select('id, amount_cents, reason, created_at')
        .eq('organization_id', orgId)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to) as unknown as Page<WalletEntry>,
    { label: 'wallet/extrato' },
  )
}
