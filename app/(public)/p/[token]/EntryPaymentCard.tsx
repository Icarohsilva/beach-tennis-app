'use client'
// app/(public)/p/[token]/EntryPaymentCard.tsx
import { useState, useTransition } from 'react'
import { startEntryCheckout, uploadEntryPaymentReceipt, type PublicEntryPayment } from '@/features/torneios/entryPaymentActions'

interface Props {
  token: string
  data: PublicEntryPayment
}

function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

export function EntryPaymentCard({ token, data }: Props) {
  const [uploaded, setUploaded] = useState(!!data.receiptUrl)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function payOnline() {
    setError(null)
    startTransition(async () => {
      const res = await startEntryCheckout(token)
      if (res.error) setError(res.error)
      else if (res.initPoint) window.location.href = res.initPoint
    })
  }

  function copyPixKey() {
    if (!data.pixKey) return
    navigator.clipboard.writeText(data.pixKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const res = await uploadEntryPaymentReceipt(token, fd)
      if (res.error) setError(res.error)
      else setUploaded(true)
    })
  }

  if (data.paymentStatus === 'paid') {
    return (
      <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
        ✓ Pagamento confirmado
      </span>
    )
  }

  if (data.paymentStatus === 'free') {
    return (
      <span className="block bg-green-800/40 text-green-400 text-sm px-3 py-2 rounded-xl font-semibold w-full text-center">
        ✓ Inscrição sem custo
      </span>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-lg px-3 py-2 text-center">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Valor a pagar</p>
        <p className="text-white text-2xl font-bold">
          {formatCents(data.finalPriceCents)}
        </p>
        {data.discountPct > 0 && (
          <p className="text-green-400 text-xs mt-0.5">{data.discountPct}% de desconto já aplicado</p>
        )}
      </div>

      {data.hasCheckoutPro && (
        <button
          type="button"
          onClick={payOnline}
          disabled={isPending}
          className="block w-full rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 py-3 text-center text-sm font-semibold text-white hover:from-orange-500 hover:to-orange-400 disabled:opacity-60"
        >
          {isPending ? 'Abrindo pagamento...' : '💳 Pagar com PIX ou cartão'}
        </button>
      )}

      {!data.hasCheckoutPro && data.pixKey && (
        <>
          <div className="bg-surface rounded-lg px-3 py-2">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Chave PIX</p>
            <div className="flex items-center gap-2">
              <p className="text-white text-sm font-mono break-all min-w-0 flex-1">{data.pixKey}</p>
              <button
                type="button"
                onClick={copyPixKey}
                className="shrink-0 text-xs px-2 py-1 rounded-lg border border-surface-border text-brand-400 hover:border-brand-500"
              >
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          {uploaded ? (
            <p className="text-green-400 text-sm font-medium text-center">✓ Comprovante enviado</p>
          ) : (
            <div className="text-center">
              <label className="cursor-pointer inline-block">
                <span
                  className={`text-xs px-3 py-2 rounded-lg border border-surface-border text-slate-300 hover:border-brand-500 transition-colors ${isPending ? 'opacity-60' : ''}`}
                >
                  {isPending ? 'Enviando...' : '📎 Anexar comprovante'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFile}
                  disabled={isPending}
                />
              </label>
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  )
}
