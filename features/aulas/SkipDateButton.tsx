'use client'
import { useState, useTransition } from 'react'
import { adminSkipEnrollmentDate, adminUnskipEnrollmentDate } from './adminActions'
import { formatDate } from '@/lib/utils/dateHelpers'

interface SessionOpt { id: string; session_date: string; skipped: boolean }

export function SkipDateButton({ studentId, sessions }: { studentId: string; sessions: SessionOpt[] }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(s: SessionOpt) {
    start(async () => {
      const r = s.skipped
        ? await adminUnskipEnrollmentDate(studentId, s.id)
        : await adminSkipEnrollmentDate(studentId, s.id)
      setMsg(r.error ? `Erro: ${r.error}` : s.skipped ? 'Falta desfeita.' : 'Falta registrada.')
      setOpen(false)
    })
  }

  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((v) => !v)} disabled={pending}
        className="text-xs font-semibold text-slate-300 border border-surface-border rounded-lg px-3 py-1.5 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50"
      >
        Faltar em… ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-60 bg-surface border border-surface-border rounded-lg p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-500 px-2 pb-1">Tirar de qual data?</p>
          {sessions.length === 0 && <p className="text-xs text-slate-500 px-2 py-1">Sem datas geradas.</p>}
          {sessions.map((s) => (
            <button
              key={s.id} type="button" onClick={() => toggle(s)}
              className="w-full flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-surface-card"
            >
              <span className={s.skipped ? 'text-slate-500 line-through' : 'text-slate-200'}>{formatDate(s.session_date)}</span>
              {s.skipped && <span className="text-[11px] text-brand-500">desfazer</span>}
            </button>
          ))}
        </div>
      )}
      {msg && <span className="block text-xs text-slate-400 mt-1">{msg}</span>}
    </div>
  )
}
