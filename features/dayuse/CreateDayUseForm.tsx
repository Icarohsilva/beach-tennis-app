'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createDayUseSlot } from './actions'

export function CreateDayUseForm() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSuccess(false)
    const fd = new FormData(e.currentTarget)
    const result = await createDayUseSlot({
      court: Number(fd.get('court')),
      date: fd.get('date') as string,
      start_time: fd.get('start_time') as string,
      end_time: fd.get('end_time') as string,
      capacity: Number(fd.get('capacity')),
      notes: (fd.get('notes') as string) || undefined,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSuccess(true)
    ;(e.target as HTMLFormElement).reset()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-card border border-surface-border rounded-xl p-4 space-y-3">
      <h3 className="text-white font-semibold text-sm">Novo Slot de Day Use</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Data</label>
          <Input name="date" type="date" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Espaço</label>
          <select name="court" className="w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="1">Espaço 1</option>
            <option value="2">Espaço 2</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Início</label>
          <Input name="start_time" type="time" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Fim</label>
          <Input name="end_time" type="time" required />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Vagas</label>
          <Input name="capacity" type="number" min="1" max="20" defaultValue="8" required />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 block mb-1">Observação (opcional)</label>
        <Input name="notes" placeholder="Ex: Aberto para todos os níveis" />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {success && <p className="text-green-400 text-xs">Slot criado com sucesso!</p>}
      <Button type="submit" disabled={pending} size="sm">
        {pending ? 'Criando...' : 'Criar Slot'}
      </Button>
    </form>
  )
}
