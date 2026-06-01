'use client'
// app/(admin)/torneios/CreateTournamentForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { createTournament } from '@/features/torneios/actions'
import type { StudentLevel, TournamentModality } from '@/types'

const LEVEL_OPTIONS: StudentLevel[] = ['iniciante', 'D', 'C', 'B', 'A']
const MODALITY_OPTIONS: { value: TournamentModality; label: string }[] = [
  { value: 'dupla_fixa', label: 'Dupla Fixa' },
  { value: 'dupla_revezando', label: 'Dupla Revezando' },
]

export function CreateTournamentForm() {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [level, setLevel] = useState<StudentLevel>('C')
  const [modality, setModality] = useState<TournamentModality>('dupla_fixa')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !date) {
      setError('Preencha nome e data.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await createTournament({
        name: name.trim(),
        date,
        format: 'super8',
        modality,
        level,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setName('')
        setDate('')
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <Input
        label="Nome do torneio"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex: Super 8 — Nível C Junho"
        required
      />

      <Input
        label="Data"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Nível</label>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as StudentLevel)}
          className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {LEVEL_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-300">Modalidade</label>
        <select
          value={modality}
          onChange={(e) => setModality(e.target.value as TournamentModality)}
          className="w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {MODALITY_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-red-400 sm:col-span-2">{error}</p>}

      <div className="sm:col-span-2">
        <Button type="submit" loading={isPending}>
          Criar Torneio
        </Button>
      </div>
    </form>
  )
}
