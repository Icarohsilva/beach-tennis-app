// app/(public)/t/[id]/RegisterExternalButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { registerExternal } from '@/features/torneios/actions'
import { ShirtFields } from '@/features/torneios/ShirtFields'
import { suggestShirtName } from '@/lib/torneios/shirt'

interface Props {
  tournamentId: string
  isPaid: boolean
  finalPriceCents?: number
  /** O torneio dá camisa: a inscrição exige tamanho. */
  needsShirtSize?: boolean
  /** A camisa é estampada: pede também o nome que vai nela. */
  needsShirtName?: boolean
  /** Nome do cadastro, para sugerir o primeiro nome na estampa. */
  suggestedName?: string
}

export function RegisterExternalButton({
  tournamentId,
  isPaid,
  finalPriceCents,
  needsShirtSize = false,
  needsShirtName = false,
  suggestedName = '',
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [shirt, setShirt] = useState('')
  const [shirtName, setShirtName] = useState(() => suggestShirtName(suggestedName))
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerExternal(
        tournamentId,
        needsShirtSize ? shirt : undefined,
        needsShirtName ? shirtName : undefined,
      )
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const label = isPaid
    ? `Confirmar inscrição${finalPriceCents !== undefined ? ` · R$ ${(finalPriceCents / 100).toFixed(2).replace('.', ',')}` : ''}`
    : 'Inscrever-se'

  return (
    <div className="space-y-2">
      {needsShirtSize && (
        <ShirtFields
          size={shirt}
          onSize={setShirt}
          name={shirtName}
          onName={setShirtName}
          askName={needsShirtName}
        />
      )}
      <button
        onClick={handleRegister}
        disabled={
          isPending
          || (needsShirtSize && !shirt)
          || (needsShirtName && !shirtName.trim())
        }
        style={{ width: '100%' }}
        className="bg-gradient-to-r from-orange-600 to-orange-500 text-white border-none rounded-xl py-3 text-base font-semibold disabled:opacity-60 cursor-pointer hover:from-orange-500 hover:to-orange-400 transition-all"
      >
        {isPending ? 'Inscrevendo...' : label}
      </button>
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  )
}
