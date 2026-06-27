'use client'
// features/perfil/GenderForm.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { selfSetGender } from '@/features/organizations/actions'

interface GenderFormProps {
  current: 'M' | 'F' | null
}

export function GenderForm({ current }: GenderFormProps) {
  const [value, setValue] = useState<'M' | 'F' | ''>(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await selfSetGender(value === '' ? null : value)
      if (res.error) setError(res.error)
      else {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['M', 'F'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setValue(g)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
              value === g
                ? 'border-brand-500 bg-brand-600/20 text-white'
                : 'border-surface-border text-slate-400 hover:text-white'
            }`}
          >
            {g === 'M' ? 'Masculino' : 'Feminino'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" loading={isPending} onClick={handleSave}>
          Salvar
        </Button>
        {saved && <span className="text-xs text-green-400">Salvo!</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
