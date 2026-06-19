'use client'
// app/(admin)/admin/assinatura/SubscribeButton.tsx
// Botão client: inicia a Preapproval (server action) e redireciona o dono para o
// ambiente hospedado do Mercado Pago. Mostra erro inline. Segue o padrão dos forms
// admin (useTransition + Button de components/ui).
import { useState, useTransition } from 'react'
import { CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { subscribeToPlatform } from '@/features/platform-billing/actions'

export function SubscribeButton({ label = 'Assinar agora' }: { label?: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const res = await subscribeToPlatform()
      if (res.error) {
        setError(res.error)
        return
      }
      if (res.initPoint) {
        window.location.href = res.initPoint
      }
    })
  }

  return (
    <div>
      <Button onClick={handleClick} loading={pending} size="lg" className="w-full">
        {!pending && <CreditCard className="mr-2 h-4 w-4" />}
        {pending ? 'Redirecionando…' : label}
      </Button>
      <p className="mt-2 text-center text-xs text-slate-500">
        Pagamento seguro processado pelo Mercado Pago.
      </p>
      {error && (
        <p className="mt-2 text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
