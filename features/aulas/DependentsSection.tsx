'use client'
// features/aulas/DependentsSection.tsx

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { StudentLevel } from '@/types'
import { addDependentSelf } from './adminActions'

const LEVELS: StudentLevel[] = ['A', 'B', 'C', 'D', 'iniciante']

interface Dependent {
  id: string
  full_name: string
  level: StudentLevel
}

interface DependentsSectionProps {
  initialDependents: Dependent[]
}

export function DependentsSection({ initialDependents }: DependentsSectionProps) {
  const [dependents, setDependents] = useState<Dependent[]>(initialDependents)
  const [name, setName] = useState('')
  const [level, setLevel] = useState<StudentLevel>('iniciante')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function notify(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  function handleAdd() {
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addDependentSelf(name, level)
      if (result.error) {
        setError(result.error)
        return
      }
      setDependents((prev) => [
        ...prev,
        {
          id: result.dependentId ?? crypto.randomUUID(),
          full_name: name.trim(),
          level,
        },
      ])
      setName('')
      setLevel('iniciante')
      notify('Dependente adicionado com sucesso.')
    })
  }

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {successMsg && (
        <div className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-2">
          {successMsg}
        </div>
      )}
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2">
          {error}
        </div>
      )}

      {/* List */}
      {dependents.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhum dependente cadastrado.</p>
      ) : (
        <ul className="space-y-2">
          {dependents.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between px-4 py-2 bg-surface-card border border-surface-border rounded-xl"
            >
              <span className="text-white text-sm">{d.full_name}</span>
              <Badge variant="kids">KIDS · {d.level.toUpperCase()}</Badge>
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <div className="flex gap-2 items-end pt-1">
        <div className="flex-1">
          <Input
            label="Nome do dependente"
            placeholder="Nome completo..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Nível</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as StudentLevel)}
            className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === 'iniciante' ? 'Iniciante' : l}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={isPending}
          onClick={handleAdd}
          disabled={!name.trim()}
        >
          Adicionar
        </Button>
      </div>
    </div>
  )
}
