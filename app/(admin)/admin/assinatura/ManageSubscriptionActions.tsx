'use client'
// app/(admin)/admin/assinatura/ManageSubscriptionActions.tsx
// Cancelamento (cumpre a promessa "cancela em 1 clique" da landing) e solicitação de
// reembolso/arrependimento (art. 49 CDC — 7 dias). O reembolso é só um REGISTRO: o
// time da plataforma processa manualmente, não há chamada automática à API do MP.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelPlatformSubscription, requestPlatformRefund } from '@/features/platform-billing/actions'

export function ManageSubscriptionActions() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showRefundForm, setShowRefundForm] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()

  function handleCancel() {
    if (!confirm('Cancelar sua assinatura da plataforma? Isso interrompe cobranças futuras e suspende o painel administrativo.')) return
    setError(null)
    startTransition(async () => {
      const res = await cancelPlatformSubscription()
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function handleRequestRefund() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const res = await requestPlatformRefund(reason)
      if (res.error) setError(res.error)
      else {
        setSuccess('Solicitação registrada. Nosso time entra em contato em breve.')
        setShowRefundForm(false)
        setReason('')
      }
    })
  }

  return (
    <div className="mt-4 space-y-3 border-t border-surface-border pt-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      {showRefundForm ? (
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
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowRefundForm(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button size="sm" variant="secondary" onClick={handleRequestRefund} loading={pending}>
              Enviar solicitação
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowRefundForm(true)}>
            Solicitar reembolso
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel} loading={pending}>
            Cancelar assinatura
          </Button>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Assinou há menos de 7 dias? Você tem direito a arrependimento com devolução integral —
        use &quot;Solicitar reembolso&quot;.
      </p>
    </div>
  )
}
