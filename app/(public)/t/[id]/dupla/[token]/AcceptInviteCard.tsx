'use client'
// app/(public)/t/[id]/dupla/[token]/AcceptInviteCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acceptPartnerInvite, declinePartnerInvite } from '@/features/torneios/partnerInviteActions'

interface Props {
  token: string
  tournamentId: string
  needsGender: boolean
}

export function AcceptInviteCard({ token, tournamentId, needsGender }: Props) {
  const router = useRouter()
  const [gender, setGender] = useState<'' | 'M' | 'F'>('')
  const [error, setError] = useState<string | null>(null)
  const [declined, setDeclined] = useState(false)
  const [isPending, startTransition] = useTransition()

  function accept() {
    setError(null)
    if (needsGender && !gender) {
      setError('Informe seu gênero para confirmar a dupla.')
      return
    }
    startTransition(async () => {
      const res = await acceptPartnerInvite(token, gender ? { gender } : undefined)
      if (res.error) {
        setError(res.error)
        return
      }
      router.push(`/t/${tournamentId}`)
      router.refresh()
    })
  }

  function decline() {
    setError(null)
    startTransition(async () => {
      const res = await declinePartnerInvite(token)
      if (res.error) setError(res.error)
      else setDeclined(true)
    })
  }

  if (declined) {
    return <p className="text-center text-sm text-slate-400">Convite recusado.</p>
  }

  return (
    <div className="space-y-3">
      {needsGender && (
        <label className="block text-sm text-slate-300">
          Gênero
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value as '' | 'M' | 'F')}
            className="mt-1 block w-full rounded-xl border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
          >
            <option value="">Selecione...</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Este torneio tem restrição de gênero na dupla.
          </span>
        </label>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={accept}
        disabled={isPending}
        className="block w-full rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 py-3 text-center text-sm font-semibold text-white hover:from-orange-500 hover:to-orange-400 disabled:opacity-60"
      >
        {isPending ? 'Confirmando...' : 'Aceitar e jogar em dupla'}
      </button>
      <button
        onClick={decline}
        disabled={isPending}
        className="block w-full text-center text-xs text-slate-500 hover:text-slate-300"
      >
        Recusar convite
      </button>
    </div>
  )
}
