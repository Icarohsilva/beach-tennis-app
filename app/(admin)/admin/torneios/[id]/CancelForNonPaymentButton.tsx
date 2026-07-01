'use client'
// app/(admin)/admin/torneios/[id]/CancelForNonPaymentButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelEntryForNonPayment } from '@/features/torneios/actions'

interface Props {
  entryId: string
}

export function CancelForNonPaymentButton({ entryId }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await cancelEntryForNonPayment(entryId)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
      } else {
        router.refresh()
      }
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-red-400">Tem certeza?</span>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className="text-xs bg-red-700 hover:bg-red-600 text-white rounded px-2 py-1 disabled:opacity-60 transition-colors"
        >
          {isPending ? 'Cancelando...' : 'Sim'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="text-xs text-slate-400 hover:text-white rounded px-2 py-1 transition-colors"
        >
          Não
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    )
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => setConfirming(true)}
        className="text-xs bg-red-700 hover:bg-red-600 text-white rounded px-2 py-1 transition-colors"
      >
        Cancelar por falta de pagamento
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
