'use client'
// app/(admin)/torneios/TournamentStatusActions.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { updateTournamentStatus } from '@/features/torneios/actions'
import type { TournamentStatus } from '@/types'

const STATUS_ORDER: TournamentStatus[] = ['draft', 'open', 'in_progress', 'finished']

const NEXT_STATUS_LABELS: Partial<Record<TournamentStatus, string>> = {
  draft: 'Abrir Inscrições',
  open: 'Iniciar Torneio',
  in_progress: 'Encerrar Torneio',
}

interface TournamentStatusActionsProps {
  tournamentId: string
  currentStatus: TournamentStatus
}

export function TournamentStatusActions({ tournamentId, currentStatus }: TournamentStatusActionsProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const currentIdx = STATUS_ORDER.indexOf(currentStatus)
  const nextStatus = currentIdx < STATUS_ORDER.length - 1 ? STATUS_ORDER[currentIdx + 1] : null
  const nextLabel = nextStatus ? NEXT_STATUS_LABELS[currentStatus] : null

  if (!nextStatus || !nextLabel) {
    return null
  }

  function handleAdvance() {
    if (!nextStatus) return
    setError(null)
    startTransition(async () => {
      const result = await updateTournamentStatus(tournamentId, nextStatus)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={currentStatus === 'in_progress' ? 'danger' : 'primary'}
        size="sm"
        loading={isPending}
        onClick={handleAdvance}
      >
        {nextLabel}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
