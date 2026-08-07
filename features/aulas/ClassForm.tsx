'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClass } from './class-form-actions'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import type { ClassType } from '@/types'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function ClassForm({ orgSports }: { orgSports: string[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const result = await createClass({
      name: fd.get('name') as string,
      description: fd.get('description') as string,
      type: fd.get('type') as ClassType,
      sport: (fd.get('sport') as string) || null,
      day_of_week: Number(fd.get('day_of_week')),
      start_time: fd.get('start_time') as string,
      end_time: fd.get('end_time') as string,
      max_students: Number(fd.get('max_students')),
      court: Number(fd.get('court')),
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    router.push('/admin/grade')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      <div>
        <label className="text-sm text-slate-400 block mb-1">Nome da turma *</label>
        <Input name="name" required placeholder="Ex: Terça 18h · Intermediário" />
      </div>
      <div>
        <label className="text-sm text-slate-400 block mb-1">Descrição (opcional)</label>
        <Input name="description" placeholder="Detalhes ou observações" />
      </div>
      <div>
        <label className="text-sm text-slate-400 block mb-1">Tipo</label>
        <select name="type" required className={SELECT_CLS}>
          <option value="adult">Adulto</option>
          <option value="kids">Kids</option>
        </select>
      </div>
      <div>
        <label className="text-sm text-slate-400 block mb-1">Modalidade</label>
        <select name="sport" className={SELECT_CLS} defaultValue="">
          <option value="">Sem modalidade</option>
          {orgSports.map((slug) => (
            <option key={slug} value={slug}>{sportEmoji(slug)} {sportLabel(slug)}</option>
          ))}
        </select>
        <p className="text-xs text-slate-500 mt-1">
          Só identifica a turma. Não impede nenhum aluno de reservar.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Dia da semana</label>
          <select name="day_of_week" required className={SELECT_CLS}>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Espaço</label>
          <select name="court" required className={SELECT_CLS}>
            <option value="1">Espaço 1</option>
            <option value="2">Espaço 2</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Início *</label>
          <Input name="start_time" type="time" required />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Fim *</label>
          <Input name="end_time" type="time" required />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Vagas *</label>
          <Input name="max_students" type="number" required min="1" max="20" defaultValue="8" />
        </div>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Criando...' : 'Criar Turma'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admin/grade')}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
