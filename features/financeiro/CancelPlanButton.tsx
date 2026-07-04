'use client'
// features/financeiro/CancelPlanButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelSubscription } from './actions'

export function CancelPlanButton() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleCancel() {
    if (!confirm('Cancelar seu plano? Os créditos restantes serão expirados.')) return
    setError(null)
    startTransition(async () => {
      const result = await cancelSubscription()
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div>
      <Button size="sm" variant="ghost" loading={pending} onClick={handleCancel}>
        Cancelar plano
      </Button>
      {error && (
        <p className="mt-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  )
}
