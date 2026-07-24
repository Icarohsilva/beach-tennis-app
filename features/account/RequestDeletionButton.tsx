'use client'
// features/account/RequestDeletionButton.tsx
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { requestAccountDeletion } from './actions'

export function RequestDeletionButton() {
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleSubmit() {
    if (!confirm('Solicitar a exclusão da sua conta? Nosso time vai processar o pedido e entrar em contato.')) return
    setError(null)
    startTransition(async () => {
      const res = await requestAccountDeletion(reason)
      if (res.error) setError(res.error)
      else setDone(true)
    })
  }

  if (done) {
    return <p className="text-sm text-green-400">Solicitação registrada. Você será contatado em breve.</p>
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-red-400">Zona de risco</h3>
      {!showForm ? (
        <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
          Solicitar exclusão da conta
        </Button>
      ) : (
        <div className="space-y-2">
          <label className="text-sm text-slate-300">
            Motivo (opcional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 block w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
            />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" variant="danger" onClick={handleSubmit} loading={pending}>
              Confirmar solicitação
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
