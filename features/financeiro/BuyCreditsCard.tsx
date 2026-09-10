'use client'
// features/financeiro/BuyCreditsCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { buySingleClassCredits } from './checkoutActions'
import { formatWalletCents, walletCoversAll } from '@/lib/wallet/wallet'

interface BuyCreditsCardProps {
  unitPrice: number
  /** Crédito em dinheiro do aluno nesta academia, em centavos. */
  walletCents?: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function BuyCreditsCard({ unitPrice, walletCents = 0 }: BuyCreditsCardProps) {
  const router = useRouter()
  const [qty, setQty] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalCents = Math.round(qty * unitPrice * 100)
  // Tudo ou nada, igual à action: com saldo insuficiente a compra vai inteira
  // para o cartão (o motivo está em buySingleClassCredits). Quantas aulas o
  // saldo cobre é o número que faz o aluno escolher a quantidade que fecha.
  const paidByWallet = walletCoversAll(totalCents, walletCents)
  const coveredQty = unitPrice > 0 ? Math.floor(walletCents / Math.round(unitPrice * 100)) : 0

  function handleBuy() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await buySingleClassCredits(qty)
      if (result.error) { setError(result.error); return }
      if (result.paidWithWalletCents) {
        // Pago com saldo: o crédito já está na conta, não há checkout a abrir.
        setMessage('Pago com seu crédito. As aulas já estão no seu saldo.')
        router.refresh()
        return
      }
      if (!result.initPoint) { setError('Erro inesperado.'); return }
      window.location.href = result.initPoint
    })
  }

  return (
    <Card>
      <h3 className="text-white font-semibold text-sm">Comprar aula avulsa</h3>
      <p className="text-xs text-slate-400 mt-1">
        {formatCurrency(unitPrice)} por aula · pague com PIX ou cartão e o crédito cai na hora da confirmação.
      </p>
      <div className="flex items-center gap-3 mt-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={qty <= 1 || pending} onClick={() => setQty((q) => q - 1)}>
            −
          </Button>
          <span className="text-white font-medium w-6 text-center">{qty}</span>
          <Button size="sm" variant="ghost" disabled={qty >= 20 || pending} onClick={() => setQty((q) => q + 1)}>
            +
          </Button>
        </div>
        <Button size="sm" variant="primary" loading={pending} onClick={handleBuy}>
          {paidByWallet ? 'Usar crédito' : 'Pagar'} {formatCurrency(qty * unitPrice)}
        </Button>
      </div>
      {walletCents > 0 && (
        <p className="mt-2 text-xs text-green-400">
          {paidByWallet
            ? `Seu crédito de ${formatWalletCents(walletCents)} cobre esta compra — sem cartão.`
            : `Você tem ${formatWalletCents(walletCents)} de crédito`
              + (coveredQty > 0
                ? `, que cobre ${coveredQty} ${coveredQty === 1 ? 'aula' : 'aulas'}.`
                : ', ainda abaixo do valor de uma aula.')}
        </p>
      )}
      {message && (
        <p className="mt-3 text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Card>
  )
}
