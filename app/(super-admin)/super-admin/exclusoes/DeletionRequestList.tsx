'use client'
// app/(super-admin)/super-admin/exclusoes/DeletionRequestList.tsx
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { setAccountDeletionStatus, type AccountDeletionStatus } from '@/features/super-admin/actions'

export interface DeletionRequestRow {
  id: string
  reason: string | null
  status: AccountDeletionStatus
  createdAt: string
  author: string
  orgName: string
}

const STATUS_LABEL: Record<AccountDeletionStatus, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

const STATUS_VARIANT: Record<AccountDeletionStatus, 'warning' | 'default' | 'success' | 'danger'> = {
  pendente: 'warning',
  em_andamento: 'default',
  concluida: 'success',
  cancelada: 'danger',
}

export function DeletionRequestList({ rows }: { rows: DeletionRequestRow[] }) {
  const [items, setItems] = useState(rows)
  const [, start] = useTransition()

  function updateStatus(id: string, status: AccountDeletionStatus) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)))
    start(async () => {
      await setAccountDeletionStatus(id, status)
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
              onChange={(e) => updateStatus(r.id, e.target.value as AccountDeletionStatus)}
              className="bg-surface border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {(Object.keys(STATUS_LABEL) as AccountDeletionStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </li>
      ))}
    </ul>
  )
}
