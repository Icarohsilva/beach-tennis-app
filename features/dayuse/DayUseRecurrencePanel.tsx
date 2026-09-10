'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { formatTime } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import {
  DAY_USE_KINDS,
  DAY_USE_KIND_LABEL,
  dayUseKindHint,
  formatDayUsePrice,
} from '@/lib/dayuse/dayUseKind'
import {
  createDayUseRecurrence,
  deactivateDayUseRecurrence,
  generateDayUseNow,
} from './recurrenceActions'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { DayUseKind, DayUseRecurrence } from '@/types'

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function DayUseRecurrencePanel({
  recurrences,
  orgSports,
  orgDefaultPriceCents,
  horizonDays,
}: {
  recurrences: DayUseRecurrence[]
  orgSports: string[]
  orgDefaultPriceCents: number
  horizonDays: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(recurrences.length === 0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [kind, setKind] = useState<DayUseKind>('scheduled')
  const { confirm, dialog } = useConfirm()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    const fd = new FormData(e.currentTarget)
    const result = await createDayUseRecurrence({
      day_of_week: Number(fd.get('day_of_week')),
      start_time: fd.get('start_time') as string,
      end_time: fd.get('end_time') as string,
      court: Number(fd.get('court')),
      capacity: Number(fd.get('capacity')),
      sport: (fd.get('sport') as string) || null,
      kind: fd.get('kind') as DayUseKind,
      price: (fd.get('price') as string) || null,
      notes: (fd.get('notes') as string) || null,
    })
    setPending(false)
    if (result.error) { setError(result.error); return }
    setMessage(
      result.slotsCreated
        ? `Recorrência criada. ${result.slotsCreated} data(s) já entraram na agenda.`
        : 'Recorrência criada.',
    )
    setKind('scheduled')
    ;(e.target as HTMLFormElement).reset()
    router.refresh()
  }

  async function handleRemove(rec: DayUseRecurrence) {
    const { ok } = await confirm({
      title: `Desligar o day use de toda ${DAYS[rec.day_of_week].toLowerCase()}?`,
      message:
        'As datas futuras sem ninguém reservado saem da agenda.\n'
        + 'As que já têm reserva ficam no ar — remova uma a uma se precisar.',
      confirmLabel: 'Desligar',
      cancelLabel: 'Manter',
      destructive: true,
    })
    if (!ok) return
    setPending(true)
    setError(null)
    setMessage(null)
    const r = await deactivateDayUseRecurrence(rec.id)
    setPending(false)
    if (r.error) { setError(r.error); return }
    setMessage(
      `Recorrência desligada. ${r.slotsRemoved ?? 0} data(s) removidas`
      + (r.slotsKept ? `, ${r.slotsKept} mantidas por já terem reserva.` : '.'),
    )
    router.refresh()
  }

  async function handleGenerate() {
    setPending(true)
    setError(null)
    setMessage(null)
    const r = await generateDayUseNow()
    setPending(false)
    if (r.error) { setError(r.error); return }
    setMessage(
      r.slotsCreated
        ? `${r.slotsCreated} data(s) criadas.`
        : 'Nada a criar — as datas do período já estão na agenda.',
    )
    router.refresh()
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm">Day use recorrente</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            Horário fixo semanal. O sistema cria as datas dos próximos {horizonDays} dias
            sozinho, todo dia.
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Fechar' : 'Nova recorrência'}
          </Button>
          {recurrences.length > 0 && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={handleGenerate}>
              Gerar agora
            </Button>
          )}
        </div>
      </div>

      {recurrences.length === 0 ? (
        <p className="text-slate-500 text-xs">
          Nenhuma recorrência. Sem ela, cada data de day use precisa ser criada à mão.
        </p>
      ) : (
        <ul className="space-y-2">
          {recurrences.map((rec) => (
            <li
              key={rec.id}
              className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface p-3 xs:flex-row xs:items-center xs:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium">
                  {DAYS[rec.day_of_week]} · {formatTime(rec.start_time)}–{formatTime(rec.end_time)}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">Espaço {rec.court}</span>
                  {rec.sport && (
                    <span className="text-xs text-slate-400">
                      {sportEmoji(rec.sport)} {sportLabel(rec.sport)}
                    </span>
                  )}
                  <Badge variant="default">{DAY_USE_KIND_LABEL[rec.kind]}</Badge>
                  <span className="text-xs text-slate-400">
                    {rec.capacity} {rec.kind === 'open' ? 'pessoas' : 'vagas'}
                  </span>
                  <span className="text-xs text-slate-400">
                    {rec.price_cents === null
                      ? `Padrão (${formatDayUsePrice(orgDefaultPriceCents)})`
                      : formatDayUsePrice(rec.price_cents)}
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleRemove(rec)}
                >
                  Desligar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <form onSubmit={handleSubmit} className="space-y-3 border-t border-surface-border pt-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="text-xs text-slate-400 block mb-1">Dia da semana</label>
              <select name="day_of_week" className={SELECT_CLS} required>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="min-w-0">
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
              {orgDefaultPriceCents > 0
                ? `Vazio usa o padrão da academia (${formatDayUsePrice(orgDefaultPriceCents)}).`
                : 'A academia não tem preço padrão, então vazio deixa o day use gratuito.'}
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Observação (opcional)</label>
            <Input name="notes" placeholder="Ex: Aberto para todos os níveis" />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Criando...' : 'Criar recorrência'}
          </Button>
        </form>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {message && <p className="text-green-400 text-xs">{message}</p>}
      {dialog}
    </Card>
  )
}
