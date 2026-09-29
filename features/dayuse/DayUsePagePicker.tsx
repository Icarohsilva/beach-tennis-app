'use client'
// features/dayuse/DayUsePagePicker.tsx
// Em qual página de day use esta data (ou recorrência) aparece.
//
// Um select, como o EventPicker dos torneios: a arena acabou de criar a
// recorrência de sábado e domingo e precisa jogar tudo na mesma capa sem sair
// da lista.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDayUseRecurrencePage, setDayUseSlotPage } from './pageActions'

interface Props {
  /** Data avulsa ou recorrência — a recorrência leva junto as datas futuras. */
  target: { slotId: string } | { recurrenceId: string }
  currentPageId: string | null
  options: Array<{ id: string; name: string }>
}

export function DayUsePagePicker({ target, currentPageId, options }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  if (options.length === 0) return null
  const id = 'slotId' in target ? target.slotId : target.recurrenceId

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || null
    setError(null)
    startTransition(async () => {
      const r = 'slotId' in target
        ? await setDayUseSlotPage(target.slotId, value)
        : await setDayUseRecurrencePage(target.recurrenceId, value)
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label className="sr-only" htmlFor={`dayuse-page-${id}`}>
        Página de day use
      </label>
      <select
        id={`dayuse-page-${id}`}
        value={currentPageId ?? ''}
        onChange={handleChange}
        disabled={isPending}
        className="max-w-full rounded-lg border border-surface-border bg-surface-card px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
      >
        <option value="">Sem página</option>
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
