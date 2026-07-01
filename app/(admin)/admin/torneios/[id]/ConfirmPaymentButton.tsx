// app/(admin)/admin/torneios/[id]/ConfirmPaymentButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmEntryPayment } from '@/features/torneios/actions'

export function ConfirmPaymentButton({ entryId }: { entryId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmEntryPayment(entryId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div>
      <button
        onClick={handleConfirm}
        disabled={isPending}
        className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-60 transition-colors"
      >
        {isPending ? 'Confirmando...' : '✓ Confirmar pagamento'}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
