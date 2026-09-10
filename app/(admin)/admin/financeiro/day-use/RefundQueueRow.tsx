'use client'
// app/(admin)/admin/financeiro/day-use/RefundQueueRow.tsx
// Uma linha da fila de estornos: o que a academia deve, para quem, e o anexo do
// comprovante do PIX feito.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { markRefundPaid } from '@/features/dayuse/refundActions'
import type { AdminRefund } from '@/features/dayuse/refundQueries'

export function RefundQueueRow({ refund }: { refund: AdminRefund }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const r = await markRefundPaid(refund.id, fd)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  return (
    <li className="flex flex-col gap-2 py-3 xs:flex-row xs:items-start xs:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-white">
            {formatDayUsePrice(refund.amount_cents)}
          </p>
          {refund.status === 'pendente' && <Badge variant="danger">A pagar</Badge>}
          {refund.status === 'pago' && <Badge variant="warning">Aguardando o aluno</Badge>}
          {refund.status === 'confirmado' && <Badge variant="success">Confirmado</Badge>}
          {refund.status === 'creditado' && <Badge variant="default">Virou crédito</Badge>}
        </div>
        <p className="mt-0.5 truncate text-sm text-slate-300">{refund.studentName}</p>
        {refund.slot && (
          <p className="text-xs text-slate-500 first-letter:uppercase">
            {formatDate(refund.slot.date, "EEEE, dd/MM")} ·{' '}
            {formatTime(refund.slot.start_time)}–{formatTime(refund.slot.end_time)} · Espaço{' '}
            {refund.slot.court}
          </p>
        )}
        <p className="text-xs text-slate-500">
          {refund.cause === 'arena_cancelou' ? 'Horário cancelado pela academia' : 'Cancelado pelo aluno no prazo'}
        </p>
        {refund.status === 'creditado' ? (
          <p className="mt-1 text-xs text-green-400">
            O aluno escolheu crédito no app. Nada a pagar.
          </p>
        ) : refund.pix_key ? (
          <p className="mt-1 break-all text-xs text-slate-300">
            PIX: <span className="text-white">{refund.pix_key}</span>
            {refund.pix_owner && <span className="text-slate-500"> · {refund.pix_owner}</span>}
          </p>
        ) : (
          <p className="mt-1 text-xs text-yellow-400">
            O aluno ainda não informou a chave PIX.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>

      {refund.status !== 'creditado' && (
        <div className="flex shrink-0 flex-col items-start gap-1 xs:items-end">
          {refund.proofSignedUrl && (
            <a
              href={refund.proofSignedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-400 hover:text-brand-300"
            >
              Ver comprovante
            </a>
          )}
          <label className="cursor-pointer">
            <span
              className={`inline-block rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xs text-slate-300 transition-colors hover:border-brand-500 ${isPending ? 'opacity-60' : ''}`}
            >
              {isPending
                ? 'Enviando...'
                : refund.proof_url
                  ? '📎 Trocar comprovante'
                  : '📎 Anexar comprovante do PIX'}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFile}
            />
          </label>
        </div>
      )}
    </li>
  )
}
