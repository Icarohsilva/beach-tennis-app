'use client'
// features/perfil/SportsForm.tsx
// Aluno declara quais esportes pratica nesta academia. É o dado que diz de quais
// rankings da Liga ele participa — não restringe em nada quais turmas pode reservar.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { SportsPicker } from '@/components/ui/SportsPicker'
import { selfSetSports } from '@/features/organizations/actions'

interface SportsFormProps {
  current: string[]
  orgSports: string[]
}

export function SportsForm({ current, orgSports }: SportsFormProps) {
  const [value, setValue] = useState<string[]>(current)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await selfSetSports(value)
      if (res.error) setError(res.error)
      else {
        setSaved(true)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-3">
      <SportsPicker
        value={value}
        onChange={(next) => {
          setSaved(false)
          setValue(next)
        }}
        options={orgSports}
        allowCustom={false}
        label="Esportes que você pratica aqui"
      />
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
