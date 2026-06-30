'use client'
// app/(admin)/admin/torneios/[id]/CloseTournamentButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { closeTournament } from '@/features/torneios/actions'

export function CloseTournamentButton({ tournamentId }: { tournamentId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleClose() {
    if (
      !confirm(
        'Encerrar este torneio? O pódio será preenchido automaticamente pelo ranking atual. Você poderá corrigir depois.',
      )
    )
      return
    setError(null)
    startTransition(async () => {
      const result = await closeTournament(tournamentId)
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
        onClick={handleClose}
        disabled={isPending}
        className="bg-surface-card border border-surface-border text-slate-400 rounded-lg px-3 py-1.5 text-sm hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Encerrando...' : 'Encerrar torneio'}
      </button>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
