'use client'
// app/(super-admin)/super-admin/reembolsos/RefundRequestList.tsx
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { setPlatformRefundStatus, type PlatformRefundStatus } from '@/features/super-admin/actions'

export interface RefundRequestRow {
  id: string
  reason: string | null
  status: PlatformRefundStatus
  createdAt: string
  author: string
  orgName: string
}

const STATUS_LABEL: Record<PlatformRefundStatus, string> = {
  pendente: 'Pendente',
  aprovada: 'Aprovada',
  recusada: 'Recusada',
  reembolsada: 'Reembolsada',
}

const STATUS_VARIANT: Record<PlatformRefundStatus, 'warning' | 'default' | 'success' | 'danger'> = {
  pendente: 'warning',
  aprovada: 'default',
  recusada: 'danger',
  reembolsada: 'success',
}

export function RefundRequestList({ rows }: { rows: RefundRequestRow[] }) {
  const [items, setItems] = useState(rows)
  const [, start] = useTransition()

  function updateStatus(id: string, status: PlatformRefundStatus) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
    start(async () => {
      await setPlatformRefundStatus(id, status)
    })
  }

  if (items.length === 0) return <p className="text-sm text-slate-400">Nenhuma solicitação.</p>

  return (
    <ul className="space-y-3">
      {items.map((r) => (
        <li key={r.id} className="rounded-xl border border-surface-border bg-surface-card p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-white">{r.author} · {r.orgName}</span>
            <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          </div>
          {r.reason && <p className="text-sm text-slate-300 whitespace-pre-wrap">{r.reason}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              {new Date(r.createdAt).toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
            </p>
            <select
              value={r.status}
              onChange={(e) => updateStatus(r.id, e.target.value as PlatformRefundStatus)}
              className="bg-surface border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {(Object.keys(STATUS_LABEL) as PlatformRefundStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </li>
      ))}
    </ul>
  )
}
