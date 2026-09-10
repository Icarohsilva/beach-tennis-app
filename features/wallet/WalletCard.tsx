// features/wallet/WalletCard.tsx
// Saldo em dinheiro do aluno naquela academia, com extrato.
//
// Server Component: o saldo é dinheiro, então vem do banco a cada carregamento
// em vez de viver em estado de cliente que pode ficar velho depois de uma compra.
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'
import { formatWalletCents, walletReasonLabel } from '@/lib/wallet/wallet'
import type { WalletEntry } from './walletQueries'

export function WalletCard({
  balanceCents,
  entries,
}: {
  balanceCents: number
  entries: WalletEntry[]
}) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-1 xs:flex-row xs:items-baseline xs:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Crédito em dinheiro
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{formatWalletCents(balanceCents)}</p>
        </div>
        {balanceCents > 0 && (
          <span className="shrink-0 rounded-full border border-green-700/50 bg-green-900/40 px-2 py-0.5 text-xs text-green-300">
            Disponível
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        {balanceCents > 0
          ? 'Use em day use, na compra de aulas avulsas ou em inscrição de torneio. Não vence.'
          : 'Você recebe crédito aqui quando escolhe crédito em vez de PIX no estorno de um day use.'}
      </p>

      {entries.length > 0 && (
        <ul className="divide-y divide-white/[0.06] border-t border-surface-border pt-1">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{walletReasonLabel(e.reason)}</p>
                <p className="text-xs text-slate-500">{formatDate(e.created_at, 'dd/MM/yyyy')}</p>
              </div>
              <span
                className={
                  e.amount_cents > 0
                    ? 'shrink-0 text-sm font-semibold text-green-400'
                    : 'shrink-0 text-sm font-semibold text-slate-300'
                }
              >
                {e.amount_cents > 0 ? '+' : ''}
                {formatWalletCents(e.amount_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
