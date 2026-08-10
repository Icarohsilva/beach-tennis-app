'use client'
// features/aulas/AgendarClient.tsx

import { useState, useTransition } from 'react'
import { bookNextSession, cancelBooking, skipEnrollmentSession, skipEnrollmentNoBooking } from './actions'
import { joinWaitlist, leaveWaitlist } from './waitlistActions'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Class, ClassSession, Waitlist } from '@/types'

type WaitlistEntry = Pick<Waitlist, 'id' | 'position' | 'status' | 'notified_at'> & {
  status: 'waiting' | 'offered'
}

interface AgendarClientProps {
  class_: Class
  nextSession: Pick<ClassSession, 'id' | 'session_date'> | null
  isEnrolled: boolean
  hasBooking: boolean
  bookingId?: string
  sessionBookedCount: number
  sessionWaitlistCount: number
  /** Posição do aluno na fila (1 = próximo), derivada da ordem de chegada. */
  waitlistPosition?: number | null
  waitlistEntry?: WaitlistEntry | null
  attendees: string[]
  dailyBookingCount: number
}

export function AgendarClient({
  class_: c,
  nextSession,
  isEnrolled,
  hasBooking,
  bookingId,
  sessionBookedCount,
  sessionWaitlistCount,
  waitlistPosition,
  waitlistEntry,
  attendees,
  dailyBookingCount,
}: AgendarClientProps) {
  const [showAttendees, setShowAttendees] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const isFull = sessionBookedCount >= c.max_students
  const atDailyLimit = dailyBookingCount >= 2

  function handleBook() {
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await bookNextSession(c.id)
      if (result.error) setError(result.error)
      else setSuccess('Agendamento confirmado!')
    })
  }

  function handleCancel() {
    if (!bookingId) return
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await cancelBooking(bookingId)
      if (result.error) setError(result.error)
      else setSuccess('Agendamento cancelado.')
    })
  }

  function handleSkip() {
    if (!bookingId) return
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await skipEnrollmentSession(bookingId)
      if (result.error) setError(result.error)
      else setSuccess('Falta registrada. Crédito devolvido sem vencimento.')
    })
  }

  function handleSkipNoBooking() {
    if (!c.id) return
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await skipEnrollmentNoBooking(c.id)
      if (result.error) setError(result.error)
      else setSuccess('Falta registrada para esta semana.')
    })
  }

  function handleJoin() {
    if (!nextSession) return
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await joinWaitlist(nextSession.id)
      if (result.error) setError(result.error)
      else
        setSuccess(
          result.position
            ? `Você é o ${result.position}º da fila. Avisamos se abrir vaga.`
            : 'Você entrou na lista de espera.',
        )
    })
  }

  function handleLeave() {
    if (!waitlistEntry) return
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await leaveWaitlist(waitlistEntry.id)
      if (result.error) setError(result.error)
      else setSuccess('Você saiu da lista de espera.')
    })
  }

  // Quem está na fila entra pelo agendamento normal: a corrida é resolvida lá,
  // de forma atômica, e ganhar a vaga já tira a pessoa da fila.
  function handleClaim() {
    setError('')
    setSuccess('')
    startTransition(async () => {
      const result = await bookNextSession(c.id)
      if (result.error) setError(result.error)
      else setSuccess('Vaga garantida! Você saiu da fila de espera.')
    })
  }

  return (
    <div className="px-1 space-y-3 pb-2">
      {/* Attendees toggle */}
      <div>
        <button
          type="button"
          onClick={() => setShowAttendees((v) => !v)}
          className="text-xs text-slate-400 hover:text-white transition-colors flex items-center gap-1"
        >
          <span>👥 {attendees.length}/{c.max_students} alunos</span>
          <span>{showAttendees ? '▲' : '▼'}</span>
        </button>
        {showAttendees && (
          <ul className="mt-2 pl-2 space-y-1">
            {attendees.length === 0 ? (
              <li className="text-xs text-slate-500">Nenhum aluno confirmado.</li>
            ) : (
              attendees.map((name, i) => (
                <li key={`${name}-${i}`} className="text-xs text-slate-300">
                  {name}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Next session date */}
      {nextSession && (
        <p className="text-xs text-slate-500">
          Próxima:{' '}
          <span className="text-slate-300">
            {formatDate(nextSession.session_date, "EEE, dd 'de' MMM")}
          </span>
        </p>
      )}

      {/* Feedback */}
      {success && <p className="text-xs text-green-400">{success}</p>}
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Action area */}
      {isEnrolled ? (
        // flex-wrap + gap: badge + data ("seg., 11/08") + "Sair desta aula" pediam
        // ~240px dos 256px disponíveis, sem um pixel de folga entre os lados.
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 bg-surface-card border border-surface-border rounded-xl">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="success">Aluno fixo</Badge>
            {nextSession && (
              <span className="whitespace-nowrap text-xs text-slate-400">
                {formatDate(nextSession.session_date, "EEE, dd/MM")}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={hasBooking && bookingId ? handleSkip : handleSkipNoBooking}
            className="shrink-0 text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
          >
            Sair desta aula
          </button>
        </div>
      ) : waitlistEntry && !isFull && nextSession ? (
        // Na fila E existe vaga agora: a corrida está aberta para todo mundo da
        // fila, então o destaque é entrar, não a posição.
        <div className="bg-brand-600/20 border border-brand-500/50 rounded-xl px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-brand-400">
            🔔 Vaga disponível! A vaga é de quem entrar primeiro.
          </p>
          <div className="flex items-center justify-between gap-3">
            <Button variant="primary" size="sm" loading={isPending} onClick={handleClaim}>
              Entrar na aula
            </Button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleLeave}
              className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
            >
              Sair da fila
            </button>
          </div>
        </div>
      ) : waitlistEntry ? (
        <div className="px-3 py-2 bg-surface-card border border-surface-border rounded-xl space-y-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-white">
              {waitlistPosition
                ? `${waitlistPosition}º na fila de espera`
                : 'Na fila de espera'}
              <span className="font-normal text-slate-400">
                {' '}
                de {sessionWaitlistCount}
              </span>
            </p>
            <button
              type="button"
              disabled={isPending}
              onClick={handleLeave}
              className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
            >
              Sair da fila
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Se abrir vaga, avisamos todo mundo da fila por notificação. A vaga
            fica com quem entrar primeiro.
          </p>
        </div>
      ) : hasBooking ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 bg-surface-card border border-surface-border border-l-[3px] border-l-brand-500 rounded-xl">
          <Badge variant="success">CONFIRMADO</Badge>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancel}
            className="shrink-0 text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
          >
            Sair da aula
          </button>
        </div>
      ) : isFull && nextSession ? (
        <div className="px-3 py-2 bg-surface-card border border-surface-border rounded-xl space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Badge variant="danger">LOTADA</Badge>
            <Button
              variant="secondary"
              size="sm"
              loading={isPending}
              disabled={isPending}
              onClick={handleJoin}
            >
              Entrar na fila
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">
            {sessionWaitlistCount > 0
              ? `${sessionWaitlistCount} ${sessionWaitlistCount === 1 ? 'pessoa' : 'pessoas'} na fila. `
              : 'Ninguém na fila ainda. '}
            Se alguém cancelar, avisamos a fila toda. A vaga fica com quem
            entrar primeiro.
          </p>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          loading={isPending}
          disabled={atDailyLimit || isPending}
          onClick={handleBook}
          className="w-full"
        >
          {atDailyLimit ? 'Limite de 2 aulas/dia atingido' : 'Entrar na aula'}
        </Button>
      )}
    </div>
  )
}
