'use client'
// app/(public)/d/[id]/DayUseBookButton.tsx
// O botão de reservar da página pública. Quando não há sessão ele NÃO tenta
// reservar: manda para a conta rápida com `next` de volta para cá, que é o
// caminho do torneio (/t/[id]/cadastrar) — reservar exige um id de usuário, e
// day use não tem reserva anônima (a vaga é de alguém).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { bookDayUse, cancelDayUseBooking } from '@/features/dayuse/actions'
import { setBookingRefundPixKey } from '@/features/dayuse/refundActions'

interface Props {
  slotId: string
  label: string
  signedIn: boolean
}

export function DayUseBookButton({ slotId, label, signedIn }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleClick() {
    setError(null)
    if (!signedIn) {
      router.push(`/d/${slotId}/cadastrar`)
      return
    }
    startTransition(async () => {
      const result = await bookDayUse(slotId)
      if (result.error) { setError(result.error); return }
      if (result.initPoint) {
        // Checkout Pro: mantém o pending até a navegação sair desta aba.
        window.location.href = result.initPoint
        return
      }
      router.refresh()
    })
  }

  return (
    <div>
      <Button size="lg" className="w-full" disabled={isPending} onClick={handleClick}>
        {isPending ? 'Reservando...' : label}
      </Button>
      {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
    </div>
  )
}

/**
 * Cancelar a reserva — e, quando ela foi paga, a chave PIX de estorno junto.
 *
 * A chave é opcional e coletada ANTES do cancelamento porque é aqui que ela é
 * útil: informada agora, o estorno já nasce com para onde ir. `notice` diz se
 * haverá devolução, e aparece antes do clique de propósito — descobrir que o
 * prazo passou depois de perder a vaga é o pior dos dois mundos.
 */
export function DayUseCancelButton({
  bookingId,
  notice,
  pixKey,
  pixOwner,
  paid,
}: {
  bookingId: string
  notice: string
  pixKey: string | null
  pixOwner: string | null
  paid: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [key, setKey] = useState(pixKey ?? '')
  const [owner, setOwner] = useState(pixOwner ?? '')
  const [savedKey, setSavedKey] = useState(Boolean(pixKey))
  const router = useRouter()

  function handleSaveKey() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await setBookingRefundPixKey(bookingId, key, owner)
      if (r.error) { setError(r.error); return }
      setSavedKey(true)
      setMessage('Chave PIX salva para um eventual estorno.')
    })
  }

  function handleCancel() {
    if (!confirm(`Cancelar sua reserva?\n\n${notice}`)) return
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await cancelDayUseBooking(bookingId)
      if (r.error) { setError(r.error); return }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {paid && (
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface p-3">
          <p className="text-xs text-slate-400">
            {savedKey
              ? 'Chave PIX registrada para estorno. Você pode trocá-la.'
              : 'Chave PIX para estorno (opcional — dá para informar depois).'}
          </p>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="CPF, telefone, e-mail ou chave aleatória"
          />
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Nome do titular da conta"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={isPending || !key.trim()}
            className="text-xs text-brand-400 transition-colors hover:text-brand-300 disabled:opacity-50"
          >
            {isPending ? 'Salvando...' : 'Salvar chave PIX'}
          </button>
        </div>
      )}

      <p className="text-center text-xs text-slate-500">{notice}</p>
      <div className="text-center">
        <button
          type="button"
          disabled={isPending}
          onClick={handleCancel}
          className="text-xs text-red-400 transition-colors hover:text-red-300"
        >
          {isPending ? 'Cancelando...' : 'Cancelar minha reserva'}
        </button>
      </div>
      {error && <p className="text-center text-xs text-red-400">{error}</p>}
      {message && <p className="text-center text-xs text-green-400">{message}</p>}
    </div>
  )
}
