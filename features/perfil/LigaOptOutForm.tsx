'use client'
// features/perfil/LigaOptOutForm.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { selfSetLigaOptOut } from '@/features/organizations/actions'

interface Props {
  optedOut: boolean
}

export function LigaOptOutForm({ optedOut }: Props) {
  const [checked, setChecked] = useState(optedOut)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleToggle(next: boolean) {
    setChecked(next)
    setError(null)
    startTransition(async () => {
      const result = await selfSetLigaOptOut(next)
      if (result.error) {
        setError(result.error)
        // Desfaz o toggle: o estado da tela não pode dizer que salvou quando não salvou.
        setChecked(!next)
      }
    })
  }

  return (
    <Card>
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}
      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-1 w-4 h-4 accent-brand-500"
        />
        <span>
          Não aparecer no ranking da Liga
          <span className="block text-xs text-slate-500">
            Você continua ganhando pontos, só os outros alunos não veem sua posição.
          </span>
        </span>
      </label>
    </Card>
  )
}
