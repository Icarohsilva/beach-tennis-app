'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { payDebtCheckout } from './debtActions'

export function PayDebtButton({ paymentId }: { paymentId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function pay() {
    setError(null)
    start(async () => {
      const r = await payDebtCheckout(paymentId)
      if (r.error) setError(r.error)
      else if (r.initPoint) window.location.href = r.initPoint
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" size="sm" onClick={pay} loading={pending}>
        Pagar online
      </Button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
