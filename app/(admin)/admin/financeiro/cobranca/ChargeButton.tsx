'use client'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { chargeDebt } from '@/features/financeiro/debtActions'
import type { NotificationChannel } from '@/lib/notifications/dispatch'

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: 'inapp', label: 'No app' },
  { value: 'push', label: 'Push' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

export function ChargeButton({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<NotificationChannel[]>(['inapp', 'push'])
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle(c: NotificationChannel) {
    setSelected((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function send() {
    setErr(null)
    setMsg(null)
    start(async () => {
      const r = await chargeDebt(studentId, selected)
      if (r.error) setErr(r.error)
      else {
        setMsg('Cobrança enviada.')
        setOpen(false)
      }
    })
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Cobrar</Button>
        {msg && <span className="text-xs text-green-400">{msg}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2 justify-end">
        {CHANNELS.map((c) => (
          <label key={c.value} className="flex items-center gap-1 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={selected.includes(c.value)}
              onChange={() => toggle(c.value)}
              className="w-3.5 h-3.5 accent-brand-500"
            />
            {c.label}
          </label>
        ))}
      </div>
      {err && <span className="text-xs text-red-400">{err}</span>}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
        <Button variant="primary" size="sm" onClick={send} loading={pending} disabled={selected.length === 0}>Enviar</Button>
      </div>
    </div>
  )
}
