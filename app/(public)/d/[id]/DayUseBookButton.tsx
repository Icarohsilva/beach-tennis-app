'use client'
// app/(public)/d/[id]/DayUseBookButton.tsx
// O botão de reservar da página pública. Quando não há sessão ele NÃO tenta
// reservar: manda para a conta rápida com `next` de volta para cá, que é o
// caminho do torneio (/t/[id]/cadastrar) — reservar exige um id de usuário, e
// day use não tem reserva anônima (a vaga é de alguém).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { bookDayUse, cancelDayUseBooking } from '@/features/dayuse/actions'

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

export function DayUseCancelButton({ bookingId }: { bookingId: string }) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  return (
    <div className="text-center">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const r = await cancelDayUseBooking(bookingId)
            if (r.error) { setError(r.error); return }
            router.refresh()
          })
        }}
        className="text-xs text-red-400 transition-colors hover:text-red-300"
      >
        {isPending ? 'Cancelando...' : 'Cancelar minha reserva'}
      </button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
