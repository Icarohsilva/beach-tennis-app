'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createDayUseSlot } from './actions'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import {
  DAY_USE_KINDS,
  DAY_USE_KIND_LABEL,
  dayUseKindHint,
  formatDayUsePrice,
} from '@/lib/dayuse/dayUseKind'
import type { DayUseKind } from '@/types'

const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function CreateDayUseForm({
  orgSports,
  orgDefaultPriceCents,
}: {
  orgSports: string[]
  /** system_settings.day_use_price da academia, para o admin saber no que cai o vazio. */
  orgDefaultPriceCents: number
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  // Tipo no estado (e não só no FormData) porque a dica e o rótulo de vagas
  // mudam com ele: em "livre no período" o número é teto de PESSOAS no espaço,
  // não vaga num jogo — e o admin precisa ler isso antes de digitar.
  const [kind, setKind] = useState<DayUseKind>('scheduled')

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
      sport: (fd.get('sport') as string) || null,
      kind: fd.get('kind') as DayUseKind,
      price: (fd.get('price') as string) || null,
      notes: (fd.get('notes') as string) || undefined,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setSuccess(true)
    setKind('scheduled')
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
          <select name="court" className={SELECT_CLS}>
            <option value="1">Espaço 1</option>
            <option value="2">Espaço 2</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="text-xs text-slate-400 block mb-1">Modalidade</label>
          <select name="sport" className={SELECT_CLS} defaultValue="">
            <option value="">Sem modalidade</option>
            {orgSports.map((slug) => (
              <option key={slug} value={slug}>{sportEmoji(slug)} {sportLabel(slug)}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs text-slate-400 block mb-1">Tipo</label>
          <select
            name="kind"
            className={SELECT_CLS}
            value={kind}
            onChange={(e) => setKind(e.target.value as DayUseKind)}
          >
            {DAY_USE_KINDS.map((k) => (
              <option key={k} value={k}>{DAY_USE_KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">{dayUseKindHint(kind)}</p>
      {/* Ver ClassForm: dois `type="time"` não caberiam em colunas de ~69px. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <label className="text-xs text-slate-400 block mb-1">Início</label>
          <Input name="start_time" type="time" required />
        </div>
        <div className="min-w-0">
          <label className="text-xs text-slate-400 block mb-1">Fim</label>
          <Input name="end_time" type="time" required />
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <label className="text-xs text-slate-400 block mb-1">
            {kind === 'open' ? 'Pessoas' : 'Vagas'}
          </label>
          <Input name="capacity" type="number" min="1" max="60" defaultValue="8" required />
        </div>
      </div>
      <div>
        <label className="text-xs text-slate-400 block mb-1">Preço por pessoa (opcional)</label>
        <Input name="price" type="text" inputMode="decimal" placeholder="Ex: 40,00" />
        <p className="text-xs text-slate-500 mt-1">
          Vazio usa o padrão da academia ({formatDayUsePrice(orgDefaultPriceCents)}). Digite{' '}
          <span className="text-slate-400">0</span> para deixar este day use gratuito.
        </p>
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
