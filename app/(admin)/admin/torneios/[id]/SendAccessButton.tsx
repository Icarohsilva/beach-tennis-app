'use client'
// app/(admin)/admin/torneios/[id]/SendAccessButton.tsx
// "Manda pra esse aluno o link e o acesso dele" — para quem já está inscrito,
// não só para quem acabou de ser inscrito no balcão. Gera uma senha provisória
// nova (a antiga pode ter sido esquecida ou nunca ter chegado) e abre o
// WhatsApp com o texto pronto: link do torneio, e-mail e a senha.
import { useState, useTransition } from 'react'
import { resetParticipantAccess } from '@/features/torneios/enrollActions'
import { buildAccessMessage } from '@/lib/torneios/contactMessage'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'

interface Props {
  tournamentId: string
  playerId: string
  playerName: string
  playerPhone: string | null
  tournamentName: string
  tournamentUrl: string
  orgName: string
}

export function SendAccessButton({
  tournamentId,
  playerId,
  playerName,
  playerPhone,
  tournamentName,
  tournamentUrl,
  orgName,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await resetParticipantAccess(tournamentId, playerId)
      if (result.error || !result.password || !result.email) {
        setError(result.error ?? 'Erro ao gerar o acesso.')
        return
      }
      const message = buildAccessMessage({
        toName: playerName,
        tournamentName,
        tournamentUrl,
        email: result.email,
        password: result.password,
        orgName,
      })
      // Sem telefone cadastrado, não há para onde abrir o WhatsApp — mas a senha
      // já foi trocada, então mostra por aqui mesmo em vez de deixar em silêncio.
      if (playerPhone) {
        window.open(buildWhatsAppUrl(playerPhone, message), '_blank', 'noopener,noreferrer')
      } else {
        window.prompt(`${playerName} não tem WhatsApp cadastrado. Copie o acesso:`, message)
      }
    })
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-green-400 hover:text-green-300 disabled:opacity-60"
      >
        {isPending ? 'Gerando acesso…' : '📱 Enviar acesso via WhatsApp'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
