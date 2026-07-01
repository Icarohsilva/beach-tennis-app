'use client'
// app/(public)/t/[id]/ConfirmWaitlistButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmWaitlistOffer } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
}

export function ConfirmWaitlistButton({ tournamentId }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmWaitlistOffer(tournamentId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <button
        onClick={handleConfirm}
        disabled={isPending}
        className="block w-full bg-gradient-to-r from-green-700 to-green-600 text-white text-center rounded-xl py-3 text-base font-semibold hover:from-green-600 hover:to-green-500 transition-all disabled:opacity-60"
      >
        {isPending ? 'Confirmando...' : '✅ Confirmar vaga'}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
