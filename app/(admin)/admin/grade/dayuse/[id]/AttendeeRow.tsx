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
import type { AdminAttendee } from '@/features/dayuse/adminSlotQuery'

/** O rótulo de pagamento é o do PAGAMENTO, não o da reserva. */
function paymentBadge(a: AdminAttendee) {
  if (a.paymentMethod === 'free') return <Badge variant="default">Gratuito</Badge>
  if (a.paymentMethod === 'wallet') return <Badge variant="success">Pago com crédito</Badge>
  if (a.payment?.status === 'paid') return <Badge variant="success">Pago</Badge>
  if (a.paymentMethod === 'pix_manual') {
    return a.hasReceipt
      ? <Badge variant="warning">Comprovante a conferir</Badge>
      : <Badge variant="danger">Aguardando PIX</Badge>
  }
  return <Badge variant="warning">Aguardando pagamento</Badge>
}

export function AttendeeRow({ item }: { item: AdminAttendee }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  const cancelado = item.status === 'cancelled'
  const podeConferir = item.paymentMethod === 'pix_manual'
    && item.status === 'pending_payment'

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
          <a
            href={buildWhatsAppUrl(item.phone, `Olá, ${item.name.split(' ')[0]}!`)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-400 hover:text-green-300"
          >
            WhatsApp
          </a>
        )}
        {podeConferir && (
          <div className="flex gap-2">
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
              onClick={() => {
                const motivo = prompt('Liberar a vaga e avisar o aluno. Motivo:', '')
                if (motivo === null) return
                run(() => rejectDayUseReceipt(item.bookingId, motivo))
              }}
            >
              Liberar vaga
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
