'use client'
// app/(admin)/admin/dashboard/TrialCardActions.tsx
// Botões Confirmar / Excluir de uma aula experimental pendente.
// Nome de arquivo distinto de trialActions.ts de propósito: em filesystem
// case-insensitive (Windows) nomes que diferem só por caixa colidem no import.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { confirmTrialBooking, deleteTrialBooking } from './trialActions'

export function TrialCardActions({ trialId }: { trialId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'confirm' | 'delete' | null>(null)
  const [isPending, startTransition] = useTransition()

  function run(kind: 'confirm' | 'delete', action: () => Promise<{ error?: string }>) {
    setError(null)
    setConfirming(kind)
    startTransition(async () => {
      const res = await action()
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={isPending && confirming === 'confirm'}
          disabled={isPending}
          onClick={() => run('confirm', () => confirmTrialBooking(trialId))}
        >
          Confirmar
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={isPending && confirming === 'delete'}
          disabled={isPending}
          onClick={() => run('delete', () => deleteTrialBooking(trialId))}
        >
          Excluir
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
