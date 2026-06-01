'use client'
// app/(dashboard)/torneios/[id]/RegisterButton.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { registerForTournament } from '@/features/torneios/actions'
import type { TournamentModality } from '@/types'

interface RegisterButtonProps {
  tournamentId: string
  modality: TournamentModality
}

export function RegisterButton({ tournamentId }: RegisterButtonProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleRegister() {
    setError(null)
    startTransition(async () => {
      const result = await registerForTournament(tournamentId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-2">
      <Button loading={isPending} onClick={handleRegister}>
        Inscrever-se
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
