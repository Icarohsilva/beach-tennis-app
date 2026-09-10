'use client'
// app/(admin)/admin/grade/dayuse/[id]/AttendeeRow.tsx
// Uma pessoa no day use: se pagou, por onde, o comprovante, e — quando saiu —
// a chave PIX para o estorno.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { paymentMethodLabel } from '@/lib/dayuse/paymentMethod'
import { refundStatusLabel } from '@/lib/dayuse/refundRules'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { confirmDayUseReceipt, rejectDayUseReceipt } from '@/features/dayuse/receiptActions'
import { cancelDayUseBookingAsAdmin, markDayUsePaidOnSite } from '@/features/dayuse/actions'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'
import type { AdminAttendee } from '@/features/dayuse/adminSlotQuery'

/** O rótulo de pagamento é o do PAGAMENTO, não o da reserva. */
function paymentBadge(a: AdminAttendee) {
  if (a.paymentMethod === 'free') return <Badge variant="default">Gratuito</Badge>
  if (a.paymentMethod === 'wallet') return <Badge variant="success">Pago com crédito</Badge>
  if (a.payment?.status === 'paid') return <Badge variant="success">Pago</Badge>
  if (a.paymentMethod === 'on_site') return <Badge variant="danger">A receber na arena</Badge>
  if (a.paymentMethod === 'pix_manual') {
    return a.hasReceipt
      ? <Badge variant="warning">Comprovante a conferir</Badge>
      : <Badge variant="danger">Aguardando PIX</Badge>
  }
  return <Badge variant="warning">Aguardando pagamento</Badge>
}

export function AttendeeRow({
  item,
  slotLabel,
}: {
  item: AdminAttendee
  /** "11/09 às 21:00", para a mensagem de cobrança citar o horário. */
  slotLabel?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }


  async function handleReject() {
    const { ok, text } = await confirm({
      title: 'Liberar a vaga?',
      message:
        'A reserva é cancelada e o aluno é avisado por notificação.\n'
        + 'Se ele já tinha abatido crédito, o valor volta para o saldo dele.',
      input: {
        label: 'Motivo (aparece na notificação do aluno)',
        placeholder: 'Ex: não localizei o PIX',
      },
      confirmLabel: 'Liberar vaga',
      cancelLabel: 'Voltar',
      destructive: true,
    })
    if (!ok) return
    run(() => rejectDayUseReceipt(item.bookingId, text))
  }

  async function handleCancelUnpaid() {
    const { ok, text } = await confirm({
      title: 'Cancelar esta inscrição por falta de pagamento?',
      message:
        'A vaga volta para a arena e o aluno é avisado por notificação.\n'
        + 'Se ele já tinha abatido crédito, o valor volta para o saldo dele.',
      input: {
        label: 'Motivo (aparece na notificação do aluno)',
        placeholder: 'Ex: não pagou até a data',
      },
      confirmLabel: 'Cancelar inscrição',
      cancelLabel: 'Voltar',
      destructive: true,
    })
    if (!ok) return
    run(() => cancelDayUseBookingAsAdmin(item.bookingId, text))
  }

  const cancelado = item.status === 'cancelled'
  /** Reservou e ainda não pagou — é quem a arena precisa cobrar. */
  const devendo = !cancelado
    && item.payment?.status === 'pending'
    && (item.paymentMethod === 'on_site' || item.paymentMethod === 'pix_manual')
  // Mensagem de cobrança pronta: o professor não deve ter de redigir o mesmo
  // pedido de pagamento a cada aluno.
  const cobrancaMessage = devendo
    ? `Olá, ${item.name.split(' ')[0]}! Falta o pagamento`
      + `${item.payment ? ` de ${formatDayUsePrice(item.payment.amountCents)}` : ''}`
      + ` do day use${slotLabel ? ` de ${slotLabel}` : ''}.`
      + (item.paymentMethod === 'pix_manual'
        ? ' Pode enviar o comprovante do PIX pelo app?'
        : ' Pode acertar na chegada?')
    : `Olá, ${item.name.split(' ')[0]}!`
  const podeConferir = item.paymentMethod === 'pix_manual'
    && item.status === 'pending_payment'
  // Pago na arena: a baixa é do admin, e a reserva já está confirmada.
  const podeDarBaixa = item.paymentMethod === 'on_site'
    && item.status !== 'cancelled'
    && item.payment?.status === 'pending'

  return (
    <li className={`flex flex-col gap-2 py-3 xs:flex-row xs:items-start xs:justify-between ${cancelado ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`truncate text-sm font-semibold text-white ${cancelado ? 'line-through' : ''}`}>
            {item.name}
          </p>
          {cancelado ? <Badge variant="danger">Cancelado</Badge> : paymentBadge(item)}
        </div>

        <p className="mt-0.5 text-xs text-slate-500">
          {paymentMethodLabel(item.paymentMethod)}
          {item.payment ? ` · ${formatDayUsePrice(item.payment.amountCents)}` : ''}
        </p>

        {item.refund && (
          <p className="mt-1 text-xs text-yellow-300">
            {refundStatusLabel(item.refund.status)} ·{' '}
            {formatDayUsePrice(item.refund.amountCents)}
            {item.refund.method === 'credito' && ' (virou crédito no app)'}
          </p>
        )}

        {/* Chave PIX de estorno: é o que o admin precisa em mãos para devolver
            o dinheiro de quem saiu. Vem do estorno quando ele existe, e da
            reserva quando o aluno deixou a chave antes de cancelar. */}
        {(item.refund?.pixKey || item.refundPixKey) && (
          <p className="mt-0.5 break-all text-xs text-slate-300">
            PIX para estorno:{' '}
            <span className="text-white">{item.refund?.pixKey ?? item.refundPixKey}</span>
            {(item.refund?.pixOwner ?? item.refundPixOwner) && (
              <span className="text-slate-500"> · {item.refund?.pixOwner ?? item.refundPixOwner}</span>
            )}
          </p>
        )}

        {item.refund && item.refund.status === 'pendente' && !item.refund.pixKey && (
          <p className="mt-0.5 text-xs text-yellow-400">
            O aluno ainda não informou a chave PIX.
          </p>
        )}

        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1 xs:items-end">
        {item.receiptSignedUrl && (
          <a
            href={item.receiptSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            Ver comprovante
          </a>
        )}
        {item.phone && (
          <WhatsAppButton href={buildWhatsAppUrl(item.phone, cobrancaMessage)}>
            {devendo ? 'Cobrar' : 'WhatsApp'}
          </WhatsAppButton>
        )}
        {podeDarBaixa && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(() => markDayUsePaidOnSite(item.bookingId))}
          >
            Marcar como pago
          </Button>
        )}
        {/* Não pagou e não há comprovante a recusar: o caminho de "recusar
            comprovante" não cobre quem simplesmente nunca pagou, e sem isto a
            vaga ficava presa até o horário passar. */}
        {devendo && !podeConferir && (
          <Button
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={handleCancelUnpaid}
          >
            Cancelar inscrição
          </Button>
        )}
        {podeConferir && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isPending || !item.hasReceipt}
              onClick={() => run(() => confirmDayUseReceipt(item.bookingId))}
            >
              Confirmar
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isPending}
              onClick={handleReject}
            >
              Liberar vaga
            </Button>
          </div>
        )}
        {dialog}
      </div>
    </li>
  )
}
