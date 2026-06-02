'use client'
// features/aulas/AgendarClient.tsx

import { useState, useTransition } from 'react'
import { BookingForm } from './BookingForm'
import { bookSession } from './actions'
import { joinWaitlist, leaveWaitlist, acceptWaitlistSpot } from './waitlistActions'
import { SessionAttendees } from './SessionAttendees'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Class, ClassSession, StudentLevel, Waitlist } from '@/types'

type WaitlistEntry = Pick<Waitlist, 'id' | 'position' | 'status' | 'notified_at'> & {
  status: 'waiting' | 'offered'
}

interface AgendarClientProps {
  class_: Class
  sessions: ClassSession[]
  studentId: string
  studentLevel: StudentLevel
  isDependent: boolean
  dailyBookingCounts: Record<string, number>
  sessionBookedCounts: Record<string, number>
  studentWaitlist: Record<string, WaitlistEntry>
  sessionWaitlistCounts: Record<string, number>
  sessionAttendeesMap: Record<string, string[]>
  classAttendeesMap: Record<string, string[]>
}

export function AgendarClient({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
  sessionBookedCounts,
  studentWaitlist,
  sessionWaitlistCounts,
  sessionAttendeesMap,
  classAttendeesMap,
}: AgendarClientProps) {
  const [expanded, setExpanded] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  async function handleBook(sessionId: string): Promise<{ error?: string }> {
    const result = await bookSession(sessionId)
    if (!result.error) {
      setSuccess(true)
      setExpanded(false)
    }
    return result
  }

  function handleJoin(sessionId: string) {
    startTransition(async () => {
      const result = await joinWaitlist(sessionId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else setErrors((e) => { const n = { ...e }; delete n[sessionId]; return n })
    })
  }

  function handleLeave(waitlistId: string, sessionId: string) {
    startTransition(async () => {
      const result = await leaveWaitlist(waitlistId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else setErrors((e) => { const n = { ...e }; delete n[sessionId]; return n })
    })
  }

  function handleAccept(waitlistId: string, sessionId: string) {
    startTransition(async () => {
      const result = await acceptWaitlistSpot(waitlistId)
      if (result.error) setErrors((e) => ({ ...e, [sessionId]: result.error! }))
      else { setSuccess(true); setExpanded(false) }
    })
  }

  const fullSessions = sessions.filter(
    (s) => (sessionBookedCounts[s.id] ?? 0) >= c.max_students,
  )

  if (success) {
    return (
      <div className="px-1 py-2">
        <p className="text-xs text-green-400">Agendamento confirmado!</p>
        <Button variant="ghost" size="sm" onClick={() => setSuccess(false)} className="mt-1">
          Agendar outra sessão
        </Button>
      </div>
    )
  }

  return (
    <div className="px-1 space-y-2">
      {/* Attendees per session */}
      <div className="space-y-1">
        {sessions.map((s) => {
          const attendees = sessionAttendeesMap[s.id] ?? classAttendeesMap[c.id] ?? []
          return (
            <SessionAttendees
              key={s.id}
              attendees={attendees}
              totalSpots={c.max_students}
            />
          )
        })}
      </div>

      {/* Waitlist banners for full sessions */}
      {fullSessions.map((s) => {
        const entry = studentWaitlist[s.id]
        const waitlistCount = sessionWaitlistCounts[s.id] ?? 0
        const sessionLabel = formatDate(s.session_date, 'EEE, dd/MM')
        const err = errors[s.id]

        if (entry?.status === 'offered') {
          const deadline = entry.notified_at
            ? new Date(new Date(entry.notified_at).getTime() + 60 * 60 * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '--:--'
          return (
            <div key={s.id} className="bg-brand-600/20 border border-brand-500/50 rounded-xl px-3 py-2">
              <p className="text-xs text-brand-400 font-semibold mb-1">
                🔔 Vaga disponível! {sessionLabel} — confirme até {deadline}
              </p>
              {err && <p className="text-xs text-red-400 mb-1">{err}</p>}
              <Button
                variant="primary"
                size="sm"
                loading={isPending}
                onClick={() => handleAccept(entry.id, s.id)}
              >
                Confirmar presença
              </Button>
            </div>
          )
        }

        if (entry?.status === 'waiting') {
          return (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-surface-card border border-surface-border rounded-xl">
              <p className="text-xs text-slate-400">
                {sessionLabel} — Fila: {entry.position}º de {waitlistCount}
              </p>
              {err && <p className="text-xs text-red-400">{err}</p>}
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleLeave(entry.id, s.id)}
                className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
              >
                Sair da fila
              </button>
            </div>
          )
        }

        return (
          <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-surface-card border border-surface-border rounded-xl">
            <p className="text-xs text-slate-400">
              {sessionLabel} — Lotada · Fila: {waitlistCount}/{c.max_students}
            </p>
            {err && <p className="text-xs text-red-400">{err}</p>}
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleJoin(s.id)}
              className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
            >
              Entrar na fila
            </button>
          </div>
        )
      })}

      {/* Booking form for sessions (full sessions shown as disabled in BookingForm) */}
      {!expanded ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExpanded(true)}
          className="w-full mt-1"
        >
          Ver sessões disponíveis
        </Button>
      ) : (
        <div>
          <BookingForm
            class_={c}
            sessions={sessions}
            studentLevel={studentLevel}
            isDependent={isDependent}
            dailyBookingCounts={dailyBookingCounts}
            sessionBookedCounts={sessionBookedCounts}
            onBook={handleBook}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
            className="w-full mt-2"
          >
            Fechar
          </Button>
        </div>
      )}
    </div>
  )
}
