'use client'
// features/perfil/NotificationToggle.tsx
// Liga/desliga as notificações push do dispositivo atual. Ponto de reentrada
// permanente (o card da home é dispensável).
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/pwa/pushClient'

export function NotificationToggle() {
  const [supported, setSupported] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false)
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => setEnabled(false))
  }, [])

  async function toggle() {
    setBusy(true)
    setMsg(null)
    const res = enabled ? await unsubscribeFromPush() : await subscribeToPush()
    setBusy(false)
    if (res.error) {
      setMsg(res.error)
    } else {
      setEnabled(!enabled)
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-slate-500">
        Este dispositivo não suporta notificações push.
      </p>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Bell size={18} className="text-brand-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-white">Notificações push</p>
          <p className="text-xs text-slate-500">
            {enabled ? 'Ativadas neste dispositivo.' : 'Receba avisos mesmo com o app fechado.'}
          </p>
          {msg && <p className="text-xs text-red-400 mt-1">{msg}</p>}
        </div>
      </div>
      <Button onClick={toggle} loading={busy} size="sm" variant={enabled ? 'secondary' : 'primary'}>
        {enabled ? 'Desativar' : 'Ativar'}
      </Button>
    </div>
  )
}
