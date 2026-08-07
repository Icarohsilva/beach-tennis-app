// app/(public)/t/[id]/RegisterExternalButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { registerExternal } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
  isPaid: boolean
  finalPriceCents?: number
}

export function RegisterExternalButton({ tournamentId, isPaid, finalPriceCents }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerExternal(tournamentId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const label = isPaid
    ? `Confirmar inscrição${finalPriceCents !== undefined ? ` · R$ ${(finalPriceCents / 100).toFixed(2).replace('.', ',')}` : ''}`
    : 'Inscrever-se'

  return (
    <div>
      <button
        onClick={handleRegister}
        disabled={isPending}
        style={{ width: '100%' }}
        className="bg-gradient-to-r from-orange-600 to-orange-500 text-white border-none rounded-xl py-3 text-base font-semibold disabled:opacity-60 cursor-pointer hover:from-orange-500 hover:to-orange-400 transition-all"
      >
        {isPending ? 'Inscrevendo...' : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
