'use client'
// app/(dashboard)/torneios/[id]/RegisterButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { registerForTournament } from '@/features/torneios/actions'

interface RegisterButtonProps {
  tournamentId: string
  participantType: string
  potentialPartners: { id: string; full_name: string }[]
}

export function RegisterButton({ tournamentId, participantType, potentialPartners }: RegisterButtonProps) {
  const [partnerId, setPartnerId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const needsPartner = participantType === 'dupla_fixa'

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const res = await registerForTournament(tournamentId, needsPartner ? partnerId || undefined : undefined)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {needsPartner && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Selecione seu parceiro</label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            <option value="">Selecione...</option>
            {potentialPartners.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>
      )}
      <Button
        loading={isPending}
        onClick={handleRegister}
        disabled={needsPartner && !partnerId}
      >
        Inscrever-se
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
