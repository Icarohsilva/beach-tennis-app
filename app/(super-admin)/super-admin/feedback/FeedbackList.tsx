'use client'
// app/(super-admin)/super-admin/feedback/FeedbackList.tsx
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { setFeedbackStatus } from '@/features/feedback/actions'

export interface FeedbackRow {
  id: string
  category: 'bug' | 'elogio' | 'ideia'
  message: string
  status: 'novo' | 'lido' | 'resolvido'
  createdAt: string
  author: string
  orgName: string
  imageUrl: string | null
}

const CAT_LABEL: Record<FeedbackRow['category'], string> = {
  bug: '🐞 Bug',
  elogio: '💛 Elogio',
  ideia: '💡 Ideia',
}

const NEXT_STATUS: Record<FeedbackRow['status'], FeedbackRow['status']> = {
  novo: 'lido',
  lido: 'resolvido',
  resolvido: 'novo',
}

const STATUS_VARIANT: Record<FeedbackRow['status'], 'warning' | 'default' | 'success'> = {
  novo: 'warning',
  lido: 'default',
  resolvido: 'success',
}

export function FeedbackList({ rows }: { rows: FeedbackRow[] }) {
  const [items, setItems] = useState(rows)
  const [filter, setFilter] = useState<'todos' | FeedbackRow['category']>('todos')
  const [, start] = useTransition()

  const visible = filter === 'todos' ? items : items.filter((i) => i.category === filter)

  function cycleStatus(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: NEXT_STATUS[i.status] } : i)),
    )
    const target = items.find((i) => i.id === id)
    if (!target) return
    const next = NEXT_STATUS[target.status]
    start(async () => {
      await setFeedbackStatus(id, next)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(['todos', 'bug', 'elogio', 'ideia'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              'rounded-full px-3 py-1 text-xs font-semibold border transition-colors ' +
              (filter === f
                ? 'border-brand-500 bg-brand-600/15 text-white'
                : 'border-surface-border text-slate-400 hover:text-white')
            }
          >
            {f === 'todos' ? 'Todos' : CAT_LABEL[f]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum feedback.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => (
            <li key={f.id} className="rounded-xl border border-surface-border bg-surface-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">{CAT_LABEL[f.category]}</span>
                <button onClick={() => cycleStatus(f.id)} title="Alterar status">
                  <Badge variant={STATUS_VARIANT[f.status]}>{f.status}</Badge>
                </button>
              </div>
              <p className="text-sm text-white whitespace-pre-wrap">{f.message}</p>
              {f.imageUrl && (
                <a href={f.imageUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.imageUrl} alt="anexo" className="max-h-48 rounded-lg border border-surface-border" />
                </a>
              )}
              <p className="text-[11px] text-slate-500">
                {f.author} · {f.orgName} ·{' '}
                {new Date(f.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
