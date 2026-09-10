'use client'
// app/(admin)/admin/financeiro/day-use/ReceiptQueueRow.tsx
// Uma linha da fila de comprovantes de PIX manual: quem reservou, quanto, o
// anexo, e as duas decisões da arena — confirmar a vaga ou liberá-la.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { confirmDayUseReceipt, rejectDayUseReceipt } from '@/features/dayuse/receiptActions'
import type { PendingReceipt } from '@/features/dayuse/refundQueries'

export function ReceiptQueueRow({ item }: { item: PendingReceipt }) {
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

  return (
    <li className="flex flex-col gap-2 py-3 xs:flex-row xs:items-start xs:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">
            {formatDayUsePrice(item.amountCents)}
          </p>
          {item.hasReceipt
            ? <Badge variant="warning">Comprovante enviado</Badge>
            : <Badge variant="default">Sem comprovante</Badge>}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-300">{item.studentName}</p>
        {item.slot && (
          <p className="text-xs text-slate-500 first-letter:uppercase">
            {formatDate(item.slot.date, "EEEE, dd/MM")} ·{' '}
            {formatTime(item.slot.start_time)}–{formatTime(item.slot.end_time)} · Espaço{' '}
            {item.slot.court}
          </p>
        )}
        <p className="text-xs text-slate-500">
          Vaga segurada até{' '}
          {item.holdUntil
            ? `${formatDate(item.holdUntil, 'dd/MM')} às ${new Date(item.holdUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            : 'confirmar'}
        </p>
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
              const motivo = prompt(
                'Liberar a vaga e avisar o aluno. Motivo (aparece na notificação):',
                '',
              )
              if (motivo === null) return
              run(() => rejectDayUseReceipt(item.bookingId, motivo))
            }}
          >
            Liberar vaga
          </Button>
        </div>
        {!item.hasReceipt && (
          <p className="text-xs text-slate-600">Confirmar só depois do comprovante.</p>
        )}
      </div>
    </li>
  )
}
