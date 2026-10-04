'use client'
// app/(admin)/admin/wellhub/AppCheckinReviewList.tsx
// Check-ins feitos pelo aluno no app, com o print do Wellhub, para a arena
// conferir. O que não bater sai pelo "Excluir", que desfaz a presença marcada.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { deleteAppCheckin } from '@/features/checkin/appCheckinActions'
import type { AppCheckinReviewRow } from '@/features/checkin/appCheckinQueries'

function quando(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function AppCheckinReviewList({ rows }: { rows: AppCheckinReviewRow[] }) {
  return (
    <Card>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum check-in pelo app nos últimos 30 dias.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {rows.map((r) => (
            <ReviewRow key={r.id} row={r} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function ReviewRow({ row }: { row: AppCheckinReviewRow }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { confirm, dialog } = useConfirm()

  async function handleDelete() {
    const { ok } = await confirm({
      title: `Excluir o check-in de ${row.studentName.split(' ')[0]}?`,
      message:
        'Use quando o print não confere com um check-in de hoje nesta arena.\n'
        + 'A presença que ele marcou na aula também sai. Se foi falta, marque na chamada.',
      confirmLabel: 'Excluir check-in',
      cancelLabel: 'Voltar',
      destructive: true,
    })
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const r = await deleteAppCheckin(row.id)
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 xs:flex-row xs:items-center xs:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{row.studentName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{quando(row.createdAt)}</span>
          {/* Resultado da leitura automática: o validado já passou na régua de
              data, hora e academia; "Conferir" é o que sobrou para o admin. */}
          {row.receiptStatus === 'validated' ? (
            <Badge variant="success">Print validado</Badge>
          ) : (
            <Badge variant="warning">Conferir</Badge>
          )}
          <Badge variant={row.sessionId ? 'success' : 'default'}>
            {row.sessionId ? 'Presença na aula' : 'Sem aula vinculada'}
          </Badge>
        </div>
        {row.receiptTakenAt && (
          <p className="mt-0.5 text-xs text-slate-500">Check-in no print: {quando(row.receiptTakenAt)}</p>
        )}
        {row.receiptNote && <p className="mt-0.5 text-xs text-yellow-300">{row.receiptNote}</p>}
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {row.receiptSignedUrl && (
          <a href={row.receiptSignedUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" size="sm">Ver print</Button>
          </a>
        )}
        <Button variant="danger" size="sm" disabled={isPending} onClick={handleDelete}>
          Excluir
        </Button>
      </div>
      {dialog}
    </li>
  )
}
