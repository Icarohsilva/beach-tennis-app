'use client'
// features/painel/AdminCalendar.tsx
// O mês da academia no painel — mesma leitura do calendário do aluno, com o que
// só o admin precisa: ocupação de cada aula, torneio em rascunho, aula
// cancelada e o aviso do que a grade ainda não gerou.
//
// O sinal de geração é a razão de o calendário existir aqui. Turma cadastrada e
// sessão gerada são coisas diferentes, separadas por um botão; quando ninguém
// aperta, o aluno abre o app e não vê aula nenhuma. Aqui o dia pendente fica
// marcado e o botão está dentro dele.
import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sun,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/dateHelpers'
import {
  KIND_LABEL,
  buildMonthGrid,
  countByKind,
  groupByDate,
  shiftMonth,
} from '@/lib/home/arenaAgenda'
import type { DayGeneration } from '@/lib/painel/gradeStatus'
import { eventTone } from '@/features/home/eventTone'
import { generateGridDate } from '@/features/aulas/gridActions'
import { loadAdminMonth } from './calendarActions'
import type { AdminEvent, AdminMonth } from './adminMonthQuery'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

interface AdminCalendarProps {
  todayISO: string
  initialMonth: string
  initialData: AdminMonth
}

export function AdminCalendar({ todayISO, initialMonth, initialData }: AdminCalendarProps) {
  const [month, setMonth] = useState(initialMonth)
  const [cache, setCache] = useState<Record<string, AdminMonth>>({ [initialMonth]: initialData })
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const data = cache[month]
  const byDate = useMemo(() => groupByDate(data?.events ?? []), [data])
  const grid = useMemo(() => buildMonthGrid(month, todayISO), [month, todayISO])
  const generation = data?.generation ?? {}

  const pendingDays = Object.entries(generation).filter(([, g]) => g.pending > 0)
  const pendingTotal = pendingDays.reduce((sum, [, g]) => sum + g.pending, 0)

  function reload(target: string) {
    startTransition(async () => {
      const loaded = await loadAdminMonth(target)
      setCache((prev) => ({ ...prev, [target]: loaded }))
    })
  }

  function go(delta: number) {
    const next = shiftMonth(month, delta)
    setMonth(next)
    setOpenDay(null)
    if (!cache[next]) reload(next)
  }

  return (
    <div className="glass rounded-2xl border border-white/[0.07] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="Mês anterior"
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-slate-300 transition-colors hover:border-brand-500/40 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <p className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white first-letter:uppercase">
          {formatDate(`${month}-01`, "MMMM 'de' yyyy")}
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />}
        </p>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label="Próximo mês"
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-slate-300 transition-colors hover:border-brand-500/40 hover:text-white"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── O que falta gerar ────────────────────────────────────────────── */}
      {pendingTotal > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-bold">
              {pendingTotal} {pendingTotal === 1 ? 'aula' : 'aulas'}
            </strong>{' '}
            da grade {pendingTotal === 1 ? 'ainda não foi gerada' : 'ainda não foram geradas'} em{' '}
            {pendingDays.length} {pendingDays.length === 1 ? 'dia' : 'dias'}. Abra o dia marcado para
            gerar.
          </span>
        </p>
      )}

      {/* ── Grade ────────────────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <span
            key={i}
            className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500"
          >
            {d}
          </span>
        ))}

        {grid.flat().map((cell) => {
          const items = byDate.get(cell.date) ?? []
          const counts = countByKind(items)
          const gen = generation[cell.date]
          const isPending = (gen?.pending ?? 0) > 0
          const has = items.length > 0 || isPending

          return (
            <button
              key={cell.date}
              type="button"
              disabled={!has}
              onClick={() => setOpenDay(cell.date)}
              aria-label={`${formatDate(cell.date, "d 'de' MMMM")}${
                items.length > 0 ? `, ${items.length} item(ns)` : ''
              }${isPending ? `, ${gen!.pending} aula(s) a gerar` : ''}`}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-xl border transition-all duration-150',
                isPending
                  ? 'border-amber-500/50 bg-amber-500/[0.08] hover:-translate-y-0.5'
                  : cell.isToday
                    ? 'border-brand-500/60 bg-brand-500/10'
                    : has
                      ? 'border-white/[0.07] bg-white/[0.04] hover:-translate-y-0.5 hover:border-brand-500/40'
                      : 'border-transparent',
                // Hoje continua marcado mesmo quando o dia está pendente: a
                // borda âmbar já foi usada pelo aviso, e sem o anel o admin
                // perde a referência de onde está no mês.
                cell.isToday && isPending && 'ring-2 ring-inset ring-brand-500/70',
                !cell.inMonth && 'opacity-40',
              )}
            >
              <span
                className={cn(
                  'text-sm font-bold leading-none',
                  isPending
                    ? 'text-amber-200'
                    : cell.isToday
                      ? 'text-brand-300'
                      : has
                        ? 'text-slate-200'
                        : 'text-slate-600',
                )}
              >
                {Number(cell.date.slice(8, 10))}
              </span>

              <span className="mt-1 flex h-1.5 items-center gap-0.5">
                {(['aula', 'torneio', 'dayuse'] as const).map((kind) =>
                  counts[kind] > 0 ? (
                    <span
                      key={kind}
                      className={cn('h-1.5 w-1.5 rounded-full', eventTone(kind).dot)}
                    />
                  ) : null,
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-white/[0.06] pt-3">
        {(['aula', 'torneio', 'dayuse'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className={cn('h-1.5 w-1.5 rounded-full', eventTone(kind).dot)} />
            {KIND_LABEL[kind]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-amber-300">
          <span className="h-2.5 w-2.5 rounded border border-amber-500/60 bg-amber-500/20" />A gerar
        </span>
      </div>

      {openDay && (
        <DayModal
          date={openDay}
          events={byDate.get(openDay) ?? []}
          generation={generation[openDay]}
          onClose={() => setOpenDay(null)}
          onGenerated={() => reload(month)}
        />
      )}
    </div>
  )
}

function DayModal({
  date,
  events,
  generation,
  onClose,
  onGenerated,
}: {
  date: string
  events: AdminEvent[]
  generation?: DayGeneration
  onClose: () => void
  onGenerated: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const root = document.documentElement
    const prevRoot = root.style.overflow
    const prevBody = document.body.style.overflow
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      root.style.overflow = prevRoot
      document.body.style.overflow = prevBody
    }
  }, [onClose])

  if (!mounted) return null

  const pending = generation?.pending ?? 0

  function handleGenerate() {
    setError(null)
    startSaving(async () => {
      const result = await generateGridDate(date)
      if (result.error) {
        setError(result.error)
        return
      }
      setDone(
        `${result.sessionsCreated ?? 0} ${(result.sessionsCreated ?? 0) === 1 ? 'aula gerada' : 'aulas geradas'} · ${result.reservados ?? 0} reservados`,
      )
      onGenerated()
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Agenda de ${date}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/[0.09] bg-surface-card p-4 pb-8 sm:rounded-3xl sm:pb-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {events.length === 1 ? '1 item' : `${events.length} itens`}
            </p>
            <h3 className="mt-0.5 text-lg font-extrabold text-white first-letter:uppercase">
              {formatDate(date, "EEEE, dd 'de' MMMM")}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.04] text-slate-300 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Gerar a grade deste dia ──────────────────────────────────── */}
        {pending > 0 && !done && (
          <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3">
            <p className="flex items-start gap-2 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {pending} {pending === 1 ? 'turma da grade ainda não tem' : 'turmas da grade ainda não têm'}{' '}
                aula gerada neste dia. Sem gerar, o aluno não vê essas aulas para agendar.
              </span>
            </p>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={saving}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-bold text-amber-950 transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Gerar aulas deste dia
            </button>
            {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          </div>
        )}

        {done && (
          <p className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2 text-xs font-semibold text-emerald-200">
            {done}
          </p>
        )}

        {events.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-6 text-center text-sm text-slate-400">
            Nada marcado neste dia.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {events.map((event) => (
              <li key={`${event.kind}-${event.id}`}>
                <DayRow event={event} onNavigate={onClose} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}

function DayRow({ event, onNavigate }: { event: AdminEvent; onNavigate: () => void }) {
  const tone = eventTone(event.kind)
  const Icon = event.kind === 'torneio' ? Trophy : event.kind === 'dayuse' ? Sun : Users
  const cancelled = event.flag === 'cancelada'

  return (
    <div
      className={cn(
        'rounded-2xl border p-3',
        cancelled
          ? 'border-white/[0.06] bg-white/[0.02] opacity-70'
          : 'border-white/[0.07] bg-white/[0.03]',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
            tone.chip,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                tone.chip,
              )}
            >
              {KIND_LABEL[event.kind]}
            </span>
            <p
              className={cn(
                'truncate text-sm font-semibold',
                cancelled ? 'text-slate-400 line-through' : 'text-white',
              )}
            >
              {event.title}
            </p>
            {event.flag && (
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase',
                  event.flag === 'rascunho'
                    ? 'bg-slate-500/20 text-slate-300'
                    : // Alterada não é problema, é informação: âmbar, não vermelho.
                      event.flag === 'alterada'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-red-500/15 text-red-300',
                )}
              >
                {event.flag}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {event.start
              ? `${event.start.slice(0, 5)}${event.end ? ` – ${event.end.slice(0, 5)}` : ''}`
              : 'Dia todo'}
            {event.subtitle ? ` · ${event.subtitle}` : ''}
            {/* Ocupação é o que o admin vem procurar: turma vazia de novo? */}
            {event.booked !== null
              ? ` · ${event.booked}${event.capacity !== null ? `/${event.capacity}` : ''} ${
                  event.kind === 'torneio' ? 'inscritos' : 'confirmados'
                }`
              : ''}
          </p>
        </div>
      </div>

      {/* Uma ação só. O "Editar" que ficava ao lado levava para a edição da
          TURMA INTEIRA a partir de uma data — e, pior, montava a URL com o id da
          sessão, que aquela rota não entende (404). Editar a data, cancelar e
          reabrir moram na ficha da aula, atrás deste mesmo botão. */}
      <div className="mt-2.5">
        {event.href && (
          <Link
            href={event.href}
            onClick={onNavigate}
            className="flex items-center justify-center rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 px-3 py-1.5 text-xs font-bold text-white transition-opacity hover:opacity-90"
          >
            {event.kind === 'aula' ? 'Ver aula' : event.kind === 'torneio' ? 'Gerenciar' : 'Abrir day use'}
          </Link>
        )}
      </div>
    </div>
  )
}
