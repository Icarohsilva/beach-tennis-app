'use client'
// app/(admin)/admin/wellhub/ChargeAllButton.tsx
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { chargeAllMissedCheckins } from '@/features/checkin/missedCheckinActions'
import type { NotificationChannel } from '@/lib/notifications/dispatch'

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: 'inapp', label: 'No app' },
  { value: 'push', label: 'Push' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export function ChargeAllButton({ studentCount }: { studentCount: number }) {
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState<NotificationChannel[]>(['inapp', 'push'])
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(c: NotificationChannel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function send() {
    setErr(null)
    setMsg(null)
    start(async () => {
      const r = await chargeAllMissedCheckins(channels)
      if (r.error) setErr(r.error)
      else {
        setMsg(`Cobrança enviada para ${r.sentCount} aluno(s).`)
        setOpen(false)
      }
    })
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Notificar {studentCount} com pendência
        </Button>
        {msg && <span className="text-xs text-green-400">{msg}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-surface-border bg-surface-card p-3">
      <p className="text-xs text-slate-300">
        Enviar a cobrança para {studentCount} aluno(s), cada um com as datas das
        pendências dele:
      </p>
      <div className="flex flex-wrap gap-3">
        {CHANNELS.map((c) => (
          <label key={c.value} className="flex items-center gap-1 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={channels.includes(c.value)}
              onChange={() => toggle(c.value)}
              className="w-3.5 h-3.5 accent-brand-500"
            />
            {c.label}
          </label>
        ))}
      </div>
      {err && <span className="text-xs text-red-400">{err}</span>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={pending}
          disabled={channels.length === 0}
          onClick={send}
        >
          Enviar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
