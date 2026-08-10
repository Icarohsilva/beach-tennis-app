'use client'
// features/home/ArenaCalendar.tsx
// O mês da arena inteiro numa tela.
//
// Substitui a lista "Minhas próximas aulas", que respondia só "o que eu marquei"
// e escondia o resto: o aluno não via que no dia 22 tem torneio nem que sábado
// tem day use. O calendário responde "o que acontece aqui" — e tocar num dia
// abre o que há nele, com o caminho para entrar na aula, no torneio ou no day use.
import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Loader2, Sun, Trophy, Users, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/dateHelpers'
import {
  KIND_LABEL,
  buildMonthGrid,
  countByKind,
  groupByDate,
  monthOf,
  shiftMonth,
  type ArenaEvent,
} from '@/lib/home/arenaAgenda'
import { eventTone } from './eventTone'
import { loadArenaMonth } from './calendarActions'

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

interface ArenaCalendarProps {
  todayISO: string
  /** Mês já carregado pelo servidor — evita um piscar vazio na primeira pintura. */
  initialMonth: string
  initialEvents: ArenaEvent[]
}

export function ArenaCalendar({ todayISO, initialMonth, initialEvents }: ArenaCalendarProps) {
  const [month, setMonth] = useState(initialMonth)
  // Cache por mês: voltar para agosto depois de ver setembro não refaz a query.
  const [cache, setCache] = useState<Record<string, ArenaEvent[]>>({
    [initialMonth]: initialEvents,
  })
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const events = cache[month]
  const byDate = useMemo(() => groupByDate(events ?? []), [events])
  const grid = useMemo(() => buildMonthGrid(month, todayISO), [month, todayISO])

  function go(delta: number) {
    const next = shiftMonth(month, delta)
    setMonth(next)
    setOpenDay(null)
    if (cache[next]) return
    startTransition(async () => {
      const loaded = await loadArenaMonth(next)
      setCache((prev) => ({ ...prev, [next]: loaded }))
    })
  }

  const dayEvents = openDay ? (byDate.get(openDay) ?? []) : []

  return (
    <div className="glass rounded-2xl border border-white/[0.07] p-3.5">
      {/* ── Cabeçalho do mês ─────────────────────────────────────────────── */}
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
          const has = items.length > 0

          return (
            <button
              key={cell.date}
              type="button"
              disabled={!has}
              onClick={() => setOpenDay(cell.date)}
              // Data por extenso: o leitor de tela soletraria "2026-08-15".
              aria-label={`${formatDate(cell.date, "d 'de' MMMM")}${
                has
                  ? `, ${items.length} ${items.length === 1 ? 'compromisso' : 'compromissos'}`
                  : ', nada marcado'
              }`}
              data-date={cell.date}
              className={cn(
                'flex aspect-square flex-col items-center justify-center rounded-xl border transition-all duration-150',
                cell.isToday
                  ? 'border-brand-500/60 bg-brand-500/10'
                  : has
                    ? 'border-white/[0.07] bg-white/[0.04] hover:-translate-y-0.5 hover:border-brand-500/40'
                    : 'border-transparent',
                // O dia de outro mês continua clicável (a semana da virada tem
                // aula de verdade), mas apaga para não competir com o mês atual.
                !cell.inMonth && 'opacity-40',
              )}
            >
              <span
                className={cn(
                  'text-sm font-bold leading-none',
                  cell.isToday
                    ? 'text-brand-300'
                    : counts.mine > 0
                      ? 'text-white'
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

      {/* ── Legenda ──────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-white/[0.06] pt-3">
        {(['aula', 'torneio', 'dayuse'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className={cn('h-1.5 w-1.5 rounded-full', eventTone(kind).dot)} />
            {KIND_LABEL[kind]}
          </span>
        ))}
      </div>

      {openDay && <DayModal date={openDay} events={dayEvents} onClose={() => setOpenDay(null)} />}
    </div>
  )
}

function DayModal({
  date,
  events,
  onClose,
}: {
  date: string
  events: ArenaEvent[]
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Fecha no Esc e trava a rolagem do fundo. Em mobile o scroller costuma ser o
  // <html>, não o <body> — travar só um deixa a home rolar por trás.
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
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/[0.09] bg-surface-card p-4 pb-8 sm:rounded-3xl sm:pb-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {events.length === 1 ? '1 compromisso' : `${events.length} compromissos`}
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

        <ul className="mt-4 space-y-2">
          {events.map((event) => (
            <li key={`${event.kind}-${event.id}`}>
              <DayRow event={event} onNavigate={onClose} />
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

function DayRow({ event, onNavigate }: { event: ArenaEvent; onNavigate: () => void }) {
  const tone = eventTone(event.kind)
  const Icon = event.kind === 'torneio' ? Trophy : event.kind === 'dayuse' ? Sun : Users

  const body = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border p-3 transition-colors',
        event.mine
          ? 'border-brand-500/40 bg-brand-500/[0.06]'
          : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.14]',
      )}
    >
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
          <p className="truncate text-sm font-semibold text-white">{event.title}</p>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {event.start ? `${event.start.slice(0, 5)}${event.end ? ` – ${event.end.slice(0, 5)}` : ''}` : 'Dia todo'}
          {event.subtitle ? ` · ${event.subtitle}` : ''}
        </p>
      </div>

      <span className={cn('shrink-0 text-[11px] font-bold', tone.text)}>
        {event.mine ? 'Ver' : event.kind === 'aula' ? 'Entrar' : 'Ver e entrar'}
      </span>
    </div>
  )

  if (!event.href) return body
  return (
    <Link href={event.href} onClick={onNavigate} className="block">
      {body}
    </Link>
  )
}
