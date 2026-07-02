'use client'
// features/perfil/PersonalDataForm.tsx
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updatePersonalData } from './profile-actions'

interface Props {
  initial: {
    full_name: string
    phone: string | null
    birth_date: string | null
  }
}

export function PersonalDataForm({ initial }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setSaved(false)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await updatePersonalData({
      full_name: (fd.get('full_name') as string) ?? '',
      phone: (fd.get('phone') as string) || undefined,
      birth_date: (fd.get('birth_date') as string) || '',
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-slate-400 block mb-1">Nome completo</label>
        <Input name="full_name" defaultValue={initial.full_name} required />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">WhatsApp</label>
          <Input
            name="phone"
            type="tel"
            placeholder="(11) 99999-9999"
            defaultValue={initial.phone ?? ''}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Data de nascimento</label>
          <Input name="birth_date" type="date" defaultValue={initial.birth_date ?? ''} />
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {saved && <p className="text-green-400 text-xs">Dados salvos com sucesso.</p>}

      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Salvando...' : 'Salvar dados'}
      </Button>
    </form>
  )
}
