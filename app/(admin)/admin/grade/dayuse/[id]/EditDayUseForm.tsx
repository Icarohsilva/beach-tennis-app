'use client'
// app/(admin)/admin/grade/dayuse/[id]/EditDayUseForm.tsx
// Editar o day use já criado. Data, horário e quadra ficam fora — ver o
// comentário de `updateDayUseSlot`: mover o horário com gente reservada é
// remarcar a vida de outras pessoas sem avisar.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import {
  DAY_USE_KINDS,
  DAY_USE_KIND_LABEL,
  dayUseKindHint,
  formatDayUsePrice,
} from '@/lib/dayuse/dayUseKind'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { deactivateDayUseSlot, updateDayUseSlot } from '@/features/dayuse/actions'
import {
  DAY_USE_PAYMENT_TIMINGS,
  DAY_USE_TIMING_LABEL,
  timingHint,
} from '@/lib/dayuse/paymentMethod'
import type { DayUsePaymentTiming } from '@/lib/dayuse/paymentMethod'
import type { DayUseKind, DayUseSlot } from '@/types'

const SELECT_CLS = 'w-full bg-surface border border-surface-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500'

export function EditDayUseForm({
  slot,
  orgSports,
  orgDefaultPriceCents,
  activeBookings,
  canCollectOnline,
}: {
  slot: DayUseSlot
  orgSports: string[]
  orgDefaultPriceCents: number
  /** Reservas que ainda valem — o texto do cancelamento depende delas. */
  activeBookings: number
  /** A academia tem Mercado Pago conectado ou chave PIX? */
  canCollectOnline: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [kind, setKind] = useState<DayUseKind>(slot.kind)
  const [timing, setTiming] = useState<DayUsePaymentTiming>(slot.payment_timing ?? 'on_site')
  const { confirm, dialog } = useConfirm()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await updateDayUseSlot(slot.id, {
        capacity: Number(fd.get('capacity')),
        sport: (fd.get('sport') as string) || null,
        kind: fd.get('kind') as DayUseKind,
        price: (fd.get('price') as string) || null,
        payment_timing: fd.get('payment_timing') as DayUsePaymentTiming,
        notes: (fd.get('notes') as string) || null,
      })
      if (r.error) { setError(r.error); return }
      setMessage('Day use atualizado.')
      router.refresh()
    })
  }

  async function handleCancel() {
    const { ok } = await confirm({
      title: 'Cancelar este day use?',
      message: activeBookings > 0
        ? `${activeBookings} reserva(s) serão canceladas, os alunos avisados e o estorno de quem pagou entra em Financeiro › Day use.`
        : 'O horário sai da agenda e do link público.',
      confirmLabel: 'Cancelar day use',
      cancelLabel: 'Voltar',
      destructive: true,
    })
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const r = await deactivateDayUseSlot(slot.id)
      if (r.error) { setError(r.error); return }
      router.push('/admin/grade/dayuse')
    })
  }

  return (
    <Card className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Editar
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-slate-400">Modalidade</label>
            <select name="sport" className={SELECT_CLS} defaultValue={slot.sport ?? ''}>
              <option value="">Sem modalidade</option>
              {orgSports.map((s) => (
                <option key={s} value={s}>{sportEmoji(s)} {sportLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-slate-400">Tipo</label>
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

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-slate-400">
              {kind === 'open' ? 'Pessoas' : 'Vagas'}
            </label>
            <Input
              name="capacity"
              type="number"
              min="1"
              max="60"
              defaultValue={slot.capacity}
              required
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-slate-400">Preço por pessoa</label>
            <Input
              name="price"
              type="text"
              inputMode="decimal"
              placeholder="Ex: 40,00"
              defaultValue={
                slot.price_cents === null
                  ? ''
                  : (slot.price_cents / 100).toFixed(2).replace('.', ',')
              }
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {orgDefaultPriceCents > 0
            ? `Vazio volta a usar o padrão da academia (${formatDayUsePrice(orgDefaultPriceCents)}).`
            : 'A academia não tem preço padrão, então vazio deixa este day use gratuito.'}
        </p>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Pagamento</label>
          <select
            name="payment_timing"
            className={SELECT_CLS}
            value={timing}
            onChange={(e) => setTiming(e.target.value as DayUsePaymentTiming)}
          >
            {DAY_USE_PAYMENT_TIMINGS.map((t) => (
              <option key={t} value={t}>{DAY_USE_TIMING_LABEL[t]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{timingHint(timing)}</p>
          {timing === 'on_booking' && !canCollectOnline && (
            <p className="mt-1 text-xs text-yellow-400">
              Sem Mercado Pago conectado nem chave PIX, não há como receber na inscrição —
              este day use continua sendo cobrado na arena.
            </p>
          )}
          {timing !== (slot.payment_timing ?? 'on_site') && activeBookings > 0 && (
            <p className="mt-1 text-xs text-yellow-400">
              {activeBookings} pessoa(s) já reservaram sob a regra anterior. A mudança vale para
              quem entrar de agora em diante — quem já está dentro mantém a forma de pagamento
              da reserva dele.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">Observação</label>
          <Input name="notes" defaultValue={slot.notes ?? ''} placeholder="Ex: Aberto para todos os níveis" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
          <Button type="button" variant="danger" size="sm" disabled={isPending} onClick={handleCancel}>
            Cancelar day use
          </Button>
        </div>
      </form>

      <p className="text-xs text-slate-500">
        Para mudar data, horário ou espaço, cancele e crie de novo — assim os alunos são
        avisados e o estorno de quem pagou acontece.
      </p>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {message && <p className="text-xs text-green-400">{message}</p>}
      {dialog}
    </Card>
  )
}
