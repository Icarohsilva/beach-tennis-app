'use client'
// app/(admin)/admin/torneios/[id]/SetGenderButtons.tsx
// "Sexo não informado · Masculino | Feminino" para o inscrito sem sexo no
// cadastro. Aparece só para quem está em branco; a regra mora em
// setParticipantGender (features/torneios/configActions.ts).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setParticipantGender } from '@/features/torneios/configActions'
import type { Gender } from '@/types'

export function SetGenderButtons({
  tournamentId,
  profileId,
  name,
}: {
  tournamentId: string
  profileId: string
  name: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function choose(gender: Gender) {
    setError(null)
    startTransition(async () => {
      const res = await setParticipantGender(tournamentId, profileId, gender)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  const chip =
    'rounded-md border border-surface-border bg-surface px-2 py-0.5 text-xs font-semibold text-slate-200 shadow-sm hover:border-brand-500 disabled:opacity-50'

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-amber-300">Sexo de {name.split(' ')[0]} não informado:</span>
        <button type="button" className={chip} disabled={pending} onClick={() => choose('M')}>
          Masculino
        </button>
        <button type="button" className={chip} disabled={pending} onClick={() => choose('F')}>
          Feminino
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
