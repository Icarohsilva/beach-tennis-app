'use client'
// app/(public)/d/[id]/DayUsePixPanel.tsx
// Reserva por PIX manual: a chave da arena para copiar, o anexo do comprovante
// e — ao lado do anexo — a chave PIX do ALUNO para um eventual estorno.
//
// As duas chaves juntas de propósito: é o momento em que a pessoa está com o
// app do banco aberto, e é onde o pedido original as colocou. Uma pede dinheiro
// dela; a outra diz para onde devolver se o day use não acontecer.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatWalletCents } from '@/lib/wallet/wallet'
import { uploadDayUseReceipt } from '@/features/dayuse/receiptActions'
import { setBookingRefundPixKey } from '@/features/dayuse/refundActions'

export function DayUsePixPanel({
  bookingId,
  amountCents,
  pixKey,
  pixOwner,
  hasReceipt,
  refundPixKey,
  refundPixOwner,
}: {
  bookingId: string
  amountCents: number
  pixKey: string
  pixOwner: string | null
  hasReceipt: boolean
  refundPixKey: string | null
  refundPixOwner: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(hasReceipt)
  const [myKey, setMyKey] = useState(refundPixKey ?? '')
  const [myOwner, setMyOwner] = useState(refundPixOwner ?? '')
  const [savedMyKey, setSavedMyKey] = useState(Boolean(refundPixKey))

  function copyKey() {
    navigator.clipboard.writeText(pixKey).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => window.prompt('Copie a chave PIX:', pixKey),
    )
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setMessage(null)
    const fd = new FormData()
    fd.set('file', file)
    startTransition(async () => {
      const r = await uploadDayUseReceipt(bookingId, fd)
      if (r.error) { setError(r.error); return }
      setSent(true)
      setMessage('Comprovante enviado. A academia vai confirmar sua vaga.')
      router.refresh()
    })
  }

  function saveMyKey() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await setBookingRefundPixKey(bookingId, myKey, myOwner)
      if (r.error) { setError(r.error); return }
      setSavedMyKey(true)
      setMessage('Chave de estorno salva.')
    })
  }

  return (
    <Card className="space-y-3 border-yellow-700/40">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-yellow-400">
          Pague por PIX para garantir a vaga
        </p>
        <p className="mt-1 text-2xl font-bold text-white">{formatWalletCents(amountCents)}</p>
        <p className="text-xs text-slate-400">
          Sua vaga fica reservada por 24 horas até a academia conferir o comprovante.
        </p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chave PIX da arena</p>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 break-all font-mono text-sm text-white">{pixKey}</p>
          <button
            type="button"
            onClick={copyKey}
            className="shrink-0 rounded-lg border border-surface-border px-2 py-1 text-xs text-brand-400 hover:border-brand-500"
          >
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
        {pixOwner && <p className="text-xs text-slate-500">{pixOwner}</p>}
      </div>

      {sent ? (
        <p className="text-xs text-yellow-400">
          ✓ Comprovante enviado. Aguardando a academia confirmar.
        </p>
      ) : (
        <label className="inline-block cursor-pointer">
          <span
            className={`inline-block rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xs text-slate-300 transition-colors hover:border-brand-500 ${isPending ? 'opacity-60' : ''}`}
          >
            {isPending ? 'Enviando...' : '📎 Enviar comprovante do PIX'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFile}
          />
        </label>
      )}

      <div className="space-y-2 border-t border-surface-border pt-3">
        <p className="text-xs text-slate-400">
          {savedMyKey
            ? 'Sua chave PIX de estorno está registrada. Você pode trocá-la.'
            : 'Sua chave PIX para estorno (opcional) — usada se o day use for cancelado.'}
        </p>
        <Input
          value={myKey}
          onChange={(e) => setMyKey(e.target.value)}
          placeholder="CPF, telefone, e-mail ou chave aleatória"
        />
        <Input
          value={myOwner}
          onChange={(e) => setMyOwner(e.target.value)}
          placeholder="Nome do titular da conta"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending || !myKey.trim()}
          onClick={saveMyKey}
        >
          Salvar chave de estorno
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {message && <p className="text-xs text-green-400">{message}</p>}
    </Card>
  )
}
