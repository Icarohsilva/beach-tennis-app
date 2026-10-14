'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { generateBracket } from '@/features/torneios/actions'

/**
 * `regenerate`: a chave já existe e nenhum placar foi lançado. Sortear de novo é
 * o caminho para aplicar uma regra de sorteio mudada depois (por exemplo, "não
 * permitir dupla masculina"); o servidor recusa se já houver placar.
 */
export function GenerateBracketButton({ tournamentId, regenerate = false }: { tournamentId: string; regenerate?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { confirm, dialog } = useConfirm()
  const router = useRouter()

  async function handle() {
    if (regenerate) {
      const { ok } = await confirm({
        title: 'Sortear as rodadas de novo?',
        message: 'As rodadas atuais são apagadas e um novo sorteio é feito com as regras de agora.\nSó é possível enquanto nenhum placar foi lançado.',
        confirmLabel: 'Sortear de novo',
        destructive: true,
      })
      if (!ok) return
    }
    setError(null)
    startTransition(async () => {
      const res = await generateBracket(tournamentId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <Button onClick={handle} loading={isPending} size="sm" variant={regenerate ? 'secondary' : 'primary'}>
        {regenerate ? 'Sortear de novo' : 'Gerar chave'}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dialog}
    </div>
  )
}
