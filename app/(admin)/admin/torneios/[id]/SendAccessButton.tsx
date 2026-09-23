'use client'
// app/(admin)/admin/torneios/[id]/SendAccessButton.tsx
// "Manda pra esse aluno o link e o acesso dele" — para quem já está inscrito,
// não só para quem acabou de ser inscrito no balcão. Gera uma senha provisória
// nova (a antiga pode ter sido esquecida ou nunca ter chegado) e abre o
// WhatsApp com o texto pronto: link do torneio, e-mail e a senha — e, se a
// parte dessa pessoa ainda não foi paga, o link direto do pagamento dela.
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
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
  /** Link pessoal de pagamento (/p/<token>) quando a parte dela está pendente. */
  paymentUrl?: string | null
  pendingAmountCents?: number
}

export function SendAccessButton({
  tournamentId,
  playerId,
  playerName,
  playerPhone,
  tournamentName,
  tournamentUrl,
  orgName,
  paymentUrl = null,
  pendingAmountCents = 0,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
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
        payment: paymentUrl && pendingAmountCents > 0
          ? { url: paymentUrl, amountCents: pendingAmountCents }
          : null,
      })
      // Sem telefone cadastrado, não há para onde abrir o WhatsApp — mas a senha
      // já foi trocada, então a mensagem vai para a área de transferência e
      // aparece aqui, em vez de sumir em silêncio.
      if (playerPhone) {
        window.open(buildWhatsAppUrl(playerPhone, message), '_blank', 'noopener,noreferrer')
      } else {
        try {
          await navigator.clipboard.writeText(message)
        } catch {
          // Sem permissão de clipboard: o texto continua visível abaixo.
        }
        setCopied(message)
      }
    })
  }

  return (
    <div className="mt-1.5 flex flex-col items-start gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} loading={isPending}>
        {isPending ? 'Gerando acesso…' : '📱 Enviar acesso via WhatsApp'}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {copied && (
        <div className="w-full space-y-1">
          <p className="text-xs text-yellow-300">
            {playerName} não tem WhatsApp cadastrado. A mensagem foi copiada, cole onde for enviar:
          </p>
          <textarea
            readOnly
            value={copied}
            rows={6}
            className="w-full rounded-lg border border-surface-border bg-surface p-2 text-xs text-slate-200"
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
    </div>
  )
}
