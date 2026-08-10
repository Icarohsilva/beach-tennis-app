'use client'
// app/(admin)/admin/torneios/EventPicker.tsx
// Em qual página de evento este torneio aparece.
//
// Um select em vez de arrastar: o admin acabou de criar seis torneios e precisa
// jogar todos na mesma capa sem sair da lista.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setTournamentEvent } from '@/features/torneios/eventActions'

interface EventPickerProps {
  tournamentId: string
  currentEventId: string | null
  options: Array<{ id: string; name: string }>
}

export function EventPicker({ tournamentId, currentEventId, options }: EventPickerProps) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    setError(null)
    startTransition(async () => {
      const result = await setTournamentEvent(tournamentId, value || null)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="sr-only" htmlFor={`event-${tournamentId}`}>
        Página de evento
      </label>
      <select
        id={`event-${tournamentId}`}
        value={currentEventId ?? ''}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
      >
        <option value="">Sem evento</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
