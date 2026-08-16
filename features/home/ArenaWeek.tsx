'use client'
// features/home/ArenaWeek.tsx
// A semana da arena inteira: aula, torneio e day use na mesma faixa.
//
// A versão anterior ("Sua semana") só conhecia aula. O aluno abria a home na
// sexta, via "nenhuma aula neste dia" e não descobria que no sábado tinha
// torneio — a informação existia, só estava em outra tela. Aqui o dia mostra o
// que a arena tem, e a bolinha diz de que tipo antes de o aluno tocar.
import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Check, Sun, Trophy, Users } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  KIND_LABEL,
  addDays,
  countByKind,
  groupByDate,
  type ArenaEvent,
} from '@/lib/home/arenaAgenda'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { Badge } from '@/components/ui/Badge'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { eventTone } from './eventTone'
import { SessionModal } from './SessionModal'
import type { AgendaSession } from './agendaTypes'

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Parte 'YYYY-MM-DD' no calendário local, sem passar por UTC. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface ArenaWeekProps {
  todayISO: string
  /** Aulas da semana — abrem a ficha em modal (entrar/sair). */
  sessions: AgendaSession[]
  /** Torneio e day use da semana — abrem a página deles. */
  events: ArenaEvent[]
}

export function ArenaWeek({ todayISO, sessions, events }: ArenaWeekProps) {
  const [selected, setSelected] = useState(todayISO)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(todayISO, i))
  const sessionsByDate = groupByDate(
    sessions.map((s) => sessionAsEvent(s)),
  )
  const eventsByDate = groupByDate(events)

  const openSession = sessions.find((s) => s.id === openSessionId) ?? null
  const daySessions = sessions.filter((s) => s.date === selected)
  const dayEvents = eventsByDate.get(selected) ?? []
  const empty = daySessions.length === 0 && dayEvents.length === 0

  return (
    <div>
      {/* ── Faixa dos 7 dias ─────────────────────────────────────────────── */}
      <div className="no-scrollbar rail-fade -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((date) => {
          const dayItems = [...(sessionsByDate.get(date) ?? []), ...(eventsByDate.get(date) ?? [])]
          const counts = countByKind(dayItems)
          const isSelected = date === selected
          const isToday = date === todayISO

          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              aria-pressed={isSelected}
              className={cn(
                'relative flex w-16 shrink-0 flex-col items-center rounded-2xl border py-2.5 transition-all duration-200',
                isSelected
                  ? 'border-transparent bg-gradient-to-b from-brand-500 to-brand-700 shadow-[0_10px_24px_-10px_rgb(var(--brand-500)/0.95)]'
                  : 'border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08]',
                isToday && !isSelected && 'ring-1 ring-inset ring-brand-500/50',
              )}
            >
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wide',
                  isSelected ? 'text-white/80' : 'text-slate-400',
                )}
              >
                {WEEKDAYS[localDate(date).getDay()]}
              </span>
              <span
                className={cn(
                  'mt-0.5 text-xl font-extrabold leading-none',
                  isSelected ? 'text-white' : 'text-slate-200',
                )}
              >
                {localDate(date).getDate()}
              </span>

              {/* Uma bolinha por TIPO, não por item: seis aulas viravam seis
                  pontos idênticos e o dia com torneio ficava igual ao sem. */}
              <span className="mt-1.5 flex h-1.5 items-center gap-1">
                {(['aula', 'torneio', 'dayuse'] as const).map((kind) =>
                  counts[kind] > 0 ? (
                    <span
                      key={kind}
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isSelected ? 'bg-white/85' : eventTone(kind).dot,
                      )}
                    />
                  ) : null,
                )}
              </span>

              <span
                className={cn(
                  'mt-1 text-[9px] font-bold uppercase tracking-wide',
                  isToday
                    ? isSelected
                      ? 'text-white/90'
                      : 'text-brand-400'
                    : 'text-transparent',
                )}
              >
                hoje
              </span>
              {counts.mine > 0 && (
                <span className="sr-only">{counts.mine} compromisso(s) seu(s)</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Itens do dia escolhido ───────────────────────────────────────── */}
      <div className="mt-3 space-y-2">
        {empty ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-7 text-center">
            <CalendarDays className="mx-auto h-6 w-6 text-slate-600" />
            <p className="mt-2 text-sm font-semibold text-slate-300">Nada marcado neste dia</p>
            <p className="mt-0.5 text-xs text-slate-400">Escolha outro dia da faixa acima.</p>
          </div>
        ) : (
          <>
            {daySessions.map((session, i) => (
              <SessionRow
                key={session.id}
                session={session}
                index={i}
                onOpen={() => setOpenSessionId(session.id)}
              />
            ))}
            {dayEvents.map((event) => (
              <EventRow key={`${event.kind}-${event.id}`} event={event} />
            ))}
          </>
        )}
      </div>

      {openSession && (
        <SessionModal
          session={openSession}
          isToday={openSession.date === todayISO}
          onClose={() => setOpenSessionId(null)}
        />
      )}
    </div>
  )
}

/** Só o que a faixa precisa saber de uma aula para contar bolinha. */
function sessionAsEvent(s: AgendaSession): ArenaEvent {
  return {
    id: s.id,
    kind: 'aula',
    date: s.date,
    start: s.start,
    end: s.end,
    title: s.className,
    subtitle: null,
    sport: s.sport,
    mine: s.mine || s.fixed,
    href: null,
    booked: s.booked,
    capacity: s.capacity,
  }
}

function SessionRow({
  session,
  index,
  onOpen,
}: {
  session: AgendaSession
  index: number
  onOpen: () => void
}) {
  const isFull = session.booked >= session.capacity
  // Aula cancelada não é "sua" nem "lotada": ela não vai acontecer. O realce de
  // dono some para não competir com o aviso, e o card fica apagado.
  const isMine = (session.mine || session.fixed) && !session.cancelled

  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left">
      <div
        className={cn(
          'glass relative overflow-hidden rounded-2xl border p-3.5 transition-all duration-200 group-hover:-translate-y-0.5',
          session.cancelled
            ? 'border-red-500/25 opacity-70'
            : isMine
              ? 'border-brand-500/40 shadow-[0_14px_34px_-26px_rgb(var(--brand-500)/0.9)]'
              : 'border-white/[0.07] group-hover:border-white/[0.14]',
        )}
      >
        {isMine && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand-400 to-brand-700"
          />
        )}
        {/* Em 320px esta linha estourava: w-12 + dois gap-3 + coluna direita
            (~90px) deixavam 98px para um meio que pedia ~122px (piso de 56px da
            barra + emoji + contador). Em 375px a folga era de ~15px e evaporava
            quando o badge dizia "Lotada" em vez de "Sua". Gaps e piso menores em
            tela estreita, e o contador "6/8" — que a barra já mostra — some. */}
        <div className="flex items-start gap-2 xs:gap-3">
          <div className="w-11 shrink-0 text-center xs:w-12">
            <p className="text-sm font-extrabold leading-none text-white">
              {session.start.slice(0, 5)}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">{session.end.slice(0, 5)}</p>
          </div>

          <div className="min-w-0 flex-1">
            {/* Modalidade na segunda linha, não ao lado do nome: no celular ela
                comia a largura e "Segunda de Teste" virava "Segunda de T…". */}
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  'truncate text-sm font-semibold text-white',
                  session.cancelled && 'line-through decoration-red-400/70',
                )}
              >
                {session.className}
              </p>
              {session.kids && <Badge variant="kids">KIDS</Badge>}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <OccupancyBar
                booked={session.booked}
                capacity={session.capacity}
                step={index}
                className="min-w-[2.5rem] flex-1 xs:min-w-[3.5rem]"
              />
              {session.sport && (
                <span className="shrink-0 text-[11px] text-slate-400">
                  {sportEmoji(session.sport)}
                  {/* No celular sobra o emoji: com o nome inteiro a barra de
                      ocupação virava um risco de 20px entre dois textos. */}
                  <span className="hidden sm:inline"> {sportLabel(session.sport)}</span>
                </span>
              )}
              <span className="hidden shrink-0 items-center gap-1 text-[11px] text-slate-400 xs:flex">
                <Users className="h-3 w-3" />
                {session.booked}/{session.capacity}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
            {session.cancelled ? (
              <span className="whitespace-nowrap rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
                Cancelada
              </span>
            ) : isMine ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                <Check className="h-3 w-3" />
                {session.fixed && !session.mine ? 'Fixa' : 'Sua'}
              </span>
            ) : (
              isFull && <Badge variant="danger">Lotada</Badge>
            )}
            {!session.cancelled && (
            <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-2 py-1 text-[10px] font-bold text-white shadow-sm shadow-brand-600/30 transition-transform group-hover:scale-105 xs:px-2.5">
              {/* "Ver / Entrar" custa ~90px de uma linha que não os tem em 320px. */}
              {isMine ? 'Ver' : <span className="hidden xs:inline">Ver / </span>}
              {!isMine && 'Entrar'}
              <ArrowRight className="h-3 w-3 shrink-0" />
            </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

/** Torneio ou day use: leva para a página do item, não abre ficha de aula. */
export function EventRow({ event }: { event: ArenaEvent }) {
  const tone = eventTone(event.kind)
  const Icon = event.kind === 'torneio' ? Trophy : Sun

  const body = (
    <div
      className={cn(
        'glass relative overflow-hidden rounded-2xl border p-3.5 transition-all duration-200',
        event.mine
          ? 'border-brand-500/40'
          : 'border-white/[0.07] group-hover:border-white/[0.14] group-hover:-translate-y-0.5',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-12 shrink-0 text-center">
          {event.start ? (
            <>
              <p className="text-sm font-extrabold leading-none text-white">
                {event.start.slice(0, 5)}
              </p>
              {event.end && <p className="mt-1 text-[10px] text-slate-400">{event.end.slice(0, 5)}</p>}
            </>
          ) : (
            <span
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-xl border',
                tone.chip,
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>

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
          {event.subtitle && (
            <p className="mt-1 truncate text-xs text-slate-400">{event.subtitle}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {event.mine && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
              <Check className="h-3 w-3" />
              Inscrito
            </span>
          )}
          <span className={cn('flex items-center gap-1 text-[11px] font-bold', tone.text)}>
            {event.mine ? 'Ver' : 'Ver e entrar'}
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>
  )

  if (!event.href) return body
  return (
    <Link href={event.href} className="group block">
      {body}
    </Link>
  )
}
