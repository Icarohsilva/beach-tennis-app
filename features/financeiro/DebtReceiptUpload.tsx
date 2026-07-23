'use client'
import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { submitDebtReceipt } from './debtActions'

interface Props {
  paymentId: string
  userId: string
  hasReceipt: boolean
  pixKey: string
  pixKeyOwner: string
}

export function DebtReceiptUpload({ paymentId, userId, hasReceipt, pixKey, pixKeyOwner }: Props) {
  const [isPending, startTransition] = useTransition()
  const [uploaded, setUploaded] = useState(hasReceipt)
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      // Extensão derivada do MIME (não do nome do arquivo, que é controlável).
      const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
      const ext = MIME_TO_EXT[file.type] ?? 'jpg'
      // Convenção {paymentId}/{userId}/receipt.ext — faz a RLS existente cobrir.
      const path = `${paymentId}/${userId}/receipt.${ext}`
      const { error: upErr } = await supabase.storage
        .from('payment-receipts')
        .upload(path, file, { upsert: true })
      if (upErr) {
        setError('Erro ao enviar comprovante. Tente novamente.')
        return
      }
      const result = await submitDebtReceipt(paymentId, path)
      if (result.error) setError(result.error)
      else setUploaded(true)
    })
  }

  if (uploaded) {
    return (
      <p className="text-xs text-yellow-400">
        ✓ Comprovante enviado — aguardando a academia conferir. Você continua bloqueado até a confirmação.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {pixKey && (
        <div className="text-xs text-slate-300 bg-surface rounded-lg border border-surface-border px-3 py-2">
          <p className="text-slate-400">Pague por PIX:</p>
          <p className="text-white font-medium break-all">{pixKey}</p>
          {pixKeyOwner && <p className="text-slate-400">{pixKeyOwner}</p>}
        </div>
      )}
      <label className="cursor-pointer inline-block">
        <span
          className={`text-xs px-3 py-2 rounded-lg border border-surface-border text-slate-300 hover:border-brand-500 transition-colors bg-surface-card ${isPending ? 'opacity-60' : ''}`}
        >
          {isPending ? 'Enviando...' : '📎 Enviar comprovante do PIX'}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
          disabled={isPending}
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
