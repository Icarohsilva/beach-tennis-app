'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { generateBracket } from '@/features/torneios/actions'

export function GenerateBracketButton({ tournamentId }: { tournamentId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handle() {
    setError(null)
    startTransition(async () => {
      const res = await generateBracket(tournamentId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <Button onClick={handle} loading={isPending} size="sm">
        Gerar chave
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
