'use client'
// app/(admin)/admin/torneios/[id]/PlaceFromWaitlistButton.tsx
// "Colocar na vaga": o admin tira a pessoa da lista de espera. A fila não anda
// sozinha (features/torneios/waitlistPromotion.ts); depois de colocar, o app já
// oferece o aviso pronto no WhatsApp, com o link de pagamento quando há.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { placeFromWaitlist } from '@/features/torneios/waitlistAdminActions'
import { buildWaitlistPlacedMessage } from '@/lib/torneios/contactMessage'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'

interface Props {
  entryId: string
  who: string
  /** Sem vaga livre: o botão fica desligado e o motivo aparece embaixo. */
  blockedReason: string | null
}

export function PlaceFromWaitlistButton({ entryId, who, blockedReason }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const { confirm, dialog } = useConfirm()
  const router = useRouter()

  async function place() {
    const { ok } = await confirm({
      title: 'Colocar na vaga?',
      message: `${who} sai da lista de espera e fica inscrito(a).\nSe o torneio é pago, o pagamento fica pendente e o link é gerado na hora.`,
      confirmLabel: 'Colocar na vaga',
    })
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const res = await placeFromWaitlist(entryId)
      if (res.error || !res.people) {
        setError(res.error ?? 'Não foi possível colocar na vaga.')
        return
      }
      const first = res.people.find((p) => p.phone)
      const notice = await confirm({
        title: 'Pronto, está na vaga',
        message: first
          ? `Avise ${first.name} pelo WhatsApp${first.paymentUrl ? ', a mensagem já leva o link de pagamento' : ''}.`
          : 'Esta pessoa não tem WhatsApp cadastrado. Avise por outro canal.',
        confirmLabel: first ? 'Avisar pelo WhatsApp' : 'Ok',
        cancelLabel: 'Fechar',
      })
      if (notice.ok && first?.phone) {
        const text = buildWaitlistPlacedMessage({
          toName: first.name,
          tournamentName: res.tournamentName ?? '',
          paymentUrl: first.paymentUrl,
          amountCents: first.amountCents,
        })
        window.open(buildWhatsAppUrl(first.phone, text), '_blank', 'noopener,noreferrer')
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" className="gap-1.5" onClick={place} disabled={pending || Boolean(blockedReason)}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
        {pending ? 'Colocando…' : 'Colocar na vaga'}
      </Button>
      {blockedReason && <p className="text-xs text-slate-400">{blockedReason}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {dialog}
    </div>
  )
}
