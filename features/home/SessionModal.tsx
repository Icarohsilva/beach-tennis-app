// features/home/SessionModal.tsx
'use client'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Users, Clock, CalendarDays, Check } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { formatDate } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { bookSession, cancelBooking, skipEnrollmentSession, skipEnrollmentForSession } from '@/features/aulas/actions'
import type { AgendaSession } from './WeekAgenda'

/**
 * Ficha da aula sobre a agenda: horário, quem já está confirmado e a ação de
 * entrar ou sair — sem tirar o aluno da home.
 */
export function SessionModal({
  session,
  onClose,
  isToday,
}: {
  session: AgendaSession
  onClose: () => void
  isToday: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => setMounted(true), [])

  // Fecha no Esc e trava a rolagem do fundo enquanto a ficha está aberta.
  // Em mobile o scroller costuma ser o <html>, não o <body> — travar só o body
  // deixava o dash rolar por trás. Travamos os dois.
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

  const isFull = session.booked >= session.capacity
  const spotsLeft = Math.max(session.capacity - session.booked, 0)

  function run(action: () => Promise<{ error?: string }>, successText: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setFeedback({ kind: 'erro', text: result.error })
      else setFeedback({ kind: 'ok', text: successText })
    })
  }

  function handleJoin() {
    run(() => bookSession(session.id), 'Presença confirmada!')
  }

  function handleLeave() {
    // Aula fixa e aula avulsa saem por caminhos diferentes: a fixa devolve
    // crédito de reposição, a avulsa segue a janela de cancelamento.
    if (session.bookingId) {
      const leave = session.fromEnrollment
        ? () => skipEnrollmentSession(session.bookingId!)
        : () => cancelBooking(session.bookingId!)
      run(leave, 'Saída registrada.')
      return
    }
    run(() => skipEnrollmentForSession(session.id), 'Falta registrada para esta data.')
  }

  const isIn = session.mine || session.fixed

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-modal-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative max-h-[85vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="session-modal-title" className="truncate text-lg font-extrabold text-white">
                {session.className}
              </h2>
              {session.kids && <Badge variant="kids">KIDS</Badge>}
              {session.sport && (
                <span className="shrink-0 text-xs text-slate-400">
                  {sportEmoji(session.sport)} {sportLabel(session.sport)}
                </span>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <CalendarDays className="h-3.5 w-3.5" />
              {isToday ? 'Hoje' : formatDate(session.date, "EEEE, d 'de' MMMM")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="shrink-0 text-center">
            <p className="text-xl font-extrabold leading-none text-white">
              {session.start.slice(0, 5)}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">até {session.end.slice(0, 5)}</p>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3 w-3" />
                {session.booked} de {session.capacity} confirmados
              </span>
              {isFull ? (
                <Badge variant="danger">Lotada</Badge>
              ) : (
                <Badge variant="success">
                  {spotsLeft} {spotsLeft === 1 ? 'vaga' : 'vagas'}
                </Badge>
              )}
            </div>
            <OccupancyBar booked={session.booked} capacity={session.capacity} className="mt-2" />
          </div>
        </div>

        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" />
            Quem está na aula ({session.attendees.length})
          </p>
          {session.attendees.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Ninguém confirmado ainda. Seja o primeiro.</p>
          ) : (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {session.attendees.map((name, i) => (
                <li
                  key={`${name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-200"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-bold text-brand-300">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {feedback && (
          <p
            role="status"
            className={
              'mt-4 rounded-lg px-3 py-2 text-xs ' +
              (feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'border border-red-500/30 bg-red-500/10 text-red-300')
            }
          >
            {feedback.text}
          </p>
        )}

        <div className="mt-5">
          {isIn ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-300">
                <Check className="h-4 w-4" />
                {session.fixed && !session.mine ? 'Sua aula fixa' : 'Você está nesta aula'}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={handleLeave}
                className="text-xs font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-50"
              >
                Sair desta aula
              </button>
            </div>
          ) : isFull ? (
            <p className="text-center text-sm text-slate-400">
              Turma lotada. Entre na fila de espera pela tela de agendar.
            </p>
          ) : (
            <Button
              variant="primary"
              loading={isPending}
              disabled={isPending}
              onClick={handleJoin}
              className="w-full"
            >
              Entrar na aula
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
