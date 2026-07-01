// app/(public)/t/[id]/ReceiptUploadButton.tsx
'use client'
import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateEntryReceipt } from '@/features/torneios/actions'

interface Props {
  tournamentId: string
  userId: string
  hasExistingReceipt: boolean
}

export function ReceiptUploadButton({ tournamentId, userId, hasExistingReceipt }: Props) {
  const [isPending, startTransition] = useTransition()
  const [uploaded, setUploaded] = useState(hasExistingReceipt)
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      // Derive extension from MIME type (safe: not controlled by filename)
      const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
      const ext = MIME_TO_EXT[file.type] ?? 'jpg'
      const path = `${tournamentId}/${userId}/receipt.${ext}`
      const { error: upErr } = await supabase.storage
        .from('payment-receipts')
        .upload(path, file, { upsert: true })
      if (upErr) {
        setError('Erro ao enviar comprovante. Tente novamente.')
        return
      }
      const result = await updateEntryReceipt(tournamentId, path)
      if (result.error) setError(result.error)
      else setUploaded(true)
    })
  }

  if (uploaded) {
    return (
      <p className="text-green-400 text-sm font-medium">✓ Comprovante enviado</p>
    )
  }

  return (
    <div>
      <label className="cursor-pointer inline-block">
        <span
          className={`text-xs px-3 py-2 rounded-lg border border-surface-border text-slate-300 hover:border-brand-500 transition-colors ${isPending ? 'opacity-60' : ''}`}
          style={{ background: '#151e31' }}
        >
          {isPending ? 'Enviando...' : '📎 Anexar comprovante (opcional)'}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleChange}
          disabled={isPending}
        />
      </label>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  )
}
