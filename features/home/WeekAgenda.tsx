// features/home/WeekAgenda.tsx
'use client'
import { useState } from 'react'
import { CalendarDays, Check, Users, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { buildWeekDays } from '@/lib/utils/agenda'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { Badge } from '@/components/ui/Badge'
import { SessionModal } from './SessionModal'

export interface AgendaSession {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  className: string
  /** 'HH:MM:SS' */
  start: string
  end: string
  booked: number
  capacity: number
  /** O aluno já tem reserva confirmada nesta sessão. */
  mine: boolean
  /** O aluno é aluno fixo da turma. */
  fixed: boolean
  kids: boolean
  /** Nomes de quem é esperado na aula (fixos + reservas). */
  attendees: string[]
  /** Reserva do aluno nesta sessão, quando existe — necessária para sair. */
  bookingId?: string
  /** A reserva do aluno veio da matrícula fixa (sai devolvendo crédito). */
  fromEnrollment?: boolean
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Parte uma data 'YYYY-MM-DD' no calendário local, sem passar por UTC. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Agenda dos próximos 7 dias. A faixa superior mostra a semana inteira de
 * relance — quais dias têm aula e quais são os do aluno — e abrir um dia troca
 * a lista abaixo sem ir ao servidor. Tocar numa aula abre a ficha dela ali
 * mesmo, com a lista de quem vai e a ação de entrar ou sair.
 */
export function WeekAgenda({
  todayISO,
  sessions,
}: {
  todayISO: string
  sessions: AgendaSession[]
}) {
  const days = buildWeekDays(todayISO, 7, sessions)
  const [selected, setSelected] = useState(todayISO)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const selectedDay = days.find((d) => d.date === selected) ?? days[0]
  const openSession = sessions.find((s) => s.id === openSessionId) ?? null

  return (
    <div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((day) => {
          const date = localDate(day.date)
          const isSelected = day.date === selected
          const isToday = day.date === todayISO
          const mineCount = day.items.filter((s) => s.mine || s.fixed).length

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setSelected(day.date)}
              aria-pressed={isSelected}
              className={cn(
                'relative flex w-[3.25rem] shrink-0 flex-col items-center rounded-2xl border py-2.5 transition-all duration-200',
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
                {WEEKDAYS[date.getDay()]}
              </span>
              <span
                className={cn(
                  'mt-0.5 text-lg font-extrabold leading-none',
                  isSelected ? 'text-white' : 'text-slate-200',
                )}
              >
                {date.getDate()}
              </span>
              <span className="mt-1.5 flex h-1.5 items-center gap-0.5">
                {day.items.slice(0, 3).map((s) => (
                  <span
                    key={s.id}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      isSelected
                        ? 'bg-white/80'
                        : s.mine || s.fixed
                          ? 'bg-brand-400'
                          : 'bg-slate-500',
                    )}
                  />
                ))}
              </span>
              {mineCount > 0 && !isSelected && (
                <span className="sr-only">{mineCount} aula(s) sua(s)</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-3 space-y-2">
        {selectedDay.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-7 text-center">
            <CalendarDays className="mx-auto h-6 w-6 text-slate-600" />
            <p className="mt-2 text-sm font-semibold text-slate-300">Nenhuma aula neste dia</p>
            <p className="mt-0.5 text-xs text-slate-400">Escolha outro dia da faixa acima.</p>
          </div>
        ) : (
          selectedDay.items.map((session, i) => {
            const isFull = session.booked >= session.capacity
            const isMine = session.mine || session.fixed

            return (
              <button
                key={session.id}
                type="button"
                onClick={() => setOpenSessionId(session.id)}
                className="group block w-full text-left"
              >
                <div
                  className={cn(
                    'glass relative overflow-hidden rounded-2xl border p-3.5 transition-all duration-200 group-hover:-translate-y-0.5',
                    isMine
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
                  <div className="flex items-start gap-3">
                    <div className="w-12 shrink-0 text-center">
                      <p className="text-sm font-extrabold leading-none text-white">
                        {session.start.slice(0, 5)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">{session.end.slice(0, 5)}</p>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">
                          {session.className}
                        </p>
                        {session.kids && <Badge variant="kids">KIDS</Badge>}
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <OccupancyBar
                          booked={session.booked}
                          capacity={session.capacity}
                          step={i}
                          className="flex-1"
                        />
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                          <Users className="h-3 w-3" />
                          {session.booked}/{session.capacity}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5 self-center">
                      {isMine ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          <Check className="h-3 w-3" />
                          {session.fixed && !session.mine ? 'Fixa' : 'Sua'}
                        </span>
                      ) : (
                        isFull && <Badge variant="danger">Lotada</Badge>
                      )}
                      {/* Chamada à ação colorida — o card inteiro é clicável e abre a ficha. */}
                      <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm shadow-brand-600/30 transition-transform group-hover:scale-105">
                        {isMine ? 'Ver' : 'Ver / Entrar'}
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            )
          })
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
