// app/(public)/t/[id]/RegisterExternalButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { registerExternal } from '@/features/torneios/actions'
import { ShirtSizeSelect } from '@/features/torneios/ShirtSizeSelect'

interface Props {
  tournamentId: string
  isPaid: boolean
  finalPriceCents?: number
  /** O torneio dá camisa: a inscrição exige tamanho. */
  needsShirtSize?: boolean
}

export function RegisterExternalButton({
  tournamentId,
  isPaid,
  finalPriceCents,
  needsShirtSize = false,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [shirt, setShirt] = useState('')
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerExternal(tournamentId, needsShirtSize ? shirt : undefined)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const label = isPaid
    ? `Confirmar inscrição${finalPriceCents !== undefined ? ` · R$ ${(finalPriceCents / 100).toFixed(2).replace('.', ',')}` : ''}`
    : 'Inscrever-se'

  return (
    <div className="space-y-2">
      {needsShirtSize && <ShirtSizeSelect value={shirt} onChange={setShirt} />}
      <button
        onClick={handleRegister}
        disabled={isPending || (needsShirtSize && !shirt)}
        style={{ width: '100%' }}
        className="bg-gradient-to-r from-orange-600 to-orange-500 text-white border-none rounded-xl py-3 text-base font-semibold disabled:opacity-60 cursor-pointer hover:from-orange-500 hover:to-orange-400 transition-all"
      >
        {isPending ? 'Inscrevendo...' : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
