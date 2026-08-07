'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { saveMedicalProfile } from './profile-actions'

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

interface Props {
  initial: {
    birth_date?: string | null
    blood_type?: string | null
    emergency_name?: string | null
    emergency_phone?: string | null
    health_notes?: string | null
  } | null
}

export function MedicalForm({ initial }: Props) {
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setSaved(false)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await saveMedicalProfile({
      blood_type: (fd.get('blood_type') as string) || undefined,
      emergency_name: (fd.get('emergency_name') as string) || undefined,
      emergency_phone: (fd.get('emergency_phone') as string) || undefined,
      health_notes: (fd.get('health_notes') as string) || undefined,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSaved(true)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-slate-400 block mb-1">Tipo sanguíneo</label>
        <select
          name="blood_type"
          defaultValue={initial?.blood_type ?? ''}
          className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Não informado</option>
          {BLOOD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Contato de emergência: nome</label>
        <Input
          name="emergency_name"
          placeholder="Nome completo"
          defaultValue={initial?.emergency_name ?? ''}
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">Contato de emergência: telefone</label>
        <Input
          name="emergency_phone"
          type="tel"
          placeholder="(11) 99999-9999"
          defaultValue={initial?.emergency_phone ?? ''}
        />
      </div>

      <div>
        <label className="text-xs text-slate-400 block mb-1">
          Observações médicas
          <span className="text-slate-500 font-normal ml-1">(alergias, medicamentos, condições pré-existentes)</span>
        </label>
        <textarea
          name="health_notes"
          rows={3}
          defaultValue={initial?.health_notes ?? ''}
          placeholder="Ex: Alérgico a dipirona. Hipertenso, uso losartana 50mg."
          className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {saved && <p className="text-green-400 text-xs">Ficha salva com sucesso.</p>}

      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Salvando...' : 'Salvar ficha'}
      </Button>
    </form>
  )
}
