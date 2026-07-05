'use client'
// features/financeiro/BuyCreditsCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { buySingleClassCredits } from './checkoutActions'

interface BuyCreditsCardProps {
  unitPrice: number
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function BuyCreditsCard({ unitPrice }: BuyCreditsCardProps) {
  const [qty, setQty] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleBuy() {
    setError(null)
    startTransition(async () => {
      const result = await buySingleClassCredits(qty)
      if (result.error || !result.initPoint) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.initPoint
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
          Pagar {formatCurrency(qty * unitPrice)}
        </Button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </Card>
  )
}
