'use client'
// Saída manual para montar o mata-mata.
//
// No caminho normal ele sai sozinho quando o último placar da fase de grupos é
// confirmado. Este botão existe para o caso que acontece de verdade na arena:
// alguém desiste, um jogo nunca é lançado e a fase nunca "acaba" sozinha — o
// professor então encerra os jogos pendentes e monta a chave daqui.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { seedKnockoutFromGroups } from '@/features/torneios/actions'

export function SeedKnockoutButton({ tournamentId }: { tournamentId: string }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handle() {
    setMessage(null)
    startTransition(async () => {
      const res = await seedKnockoutFromGroups(tournamentId)
      if (res.error) {
        setMessage({ text: res.error, error: true })
        return
      }
      if (!res.created) {
        setMessage({ text: 'O mata-mata deste torneio já está montado.', error: false })
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <Button onClick={handle} loading={isPending} size="sm" variant="secondary">
        Montar mata-mata
      </Button>
      {message && (
        <p className={message.error ? 'text-xs text-red-400' : 'text-xs text-slate-400'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
