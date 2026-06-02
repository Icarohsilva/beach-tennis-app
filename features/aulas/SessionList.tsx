'use client'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import { cancelBooking } from './actions'
import type { ClassSession, SessionBooking } from '@/types'

interface SessionListProps {
  sessions: ClassSession[]
  bookings: SessionBooking[]
  maxDisplay?: number
  showCancelButton?: boolean
}

export function SessionList({ sessions, bookings, maxDisplay = 4, showCancelButton = false }: SessionListProps) {
  const bookingBySession = new Map(bookings.map((b) => [b.session_id, b]))
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  const upcoming = sessions
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .slice(0, maxDisplay)

  function handleCancel(bookingId: string) {
    startTransition(async () => {
      const result = await cancelBooking(bookingId)
      if (result.error) {
        setErrors((prev) => ({ ...prev, [bookingId]: result.error! }))
        return
      }
      setCancelledIds((prev) => { const next = new Set(prev); next.add(bookingId); return next })
    })
  }

  if (upcoming.length === 0) {
    return <p className="text-slate-500 text-xs py-2">Sem sessões próximas.</p>
  }

  return (
    <ul className="space-y-1 mt-2">
      {upcoming.map((session) => {
        const booking = bookingBySession.get(session.id)
        const isCancelledLocally = booking ? cancelledIds.has(booking.id) : false
        const isConfirmed = booking?.status === 'confirmed' && !isCancelledLocally
        const isCancelled = booking?.status === 'cancelled' || isCancelledLocally

        return (
          <li
            key={session.id}
            className="flex items-center justify-between text-xs text-slate-300 py-1.5 border-b border-surface-border last:border-0 gap-2"
          >
            <span>{formatDate(session.session_date, 'EEE, dd/MM')}</span>
            <div className="flex items-center gap-2">
              {isConfirmed && <Badge variant="success">Confirmado</Badge>}
              {isCancelled && <Badge variant="danger">Cancelado</Badge>}
              {!booking && <Badge variant="default">Sem booking</Badge>}
              {isConfirmed && showCancelButton && booking && (
                <button
                  onClick={() => handleCancel(booking.id)}
                  disabled={isPending}
                  className="text-red-400 hover:text-red-300 text-xs underline disabled:opacity-50"
                >
                  Cancelar
                </button>
              )}
            </div>
          </li>
        )
      })}
      {Object.entries(errors).map(([id, msg]) => (
        <li key={`err-${id}`} className="text-red-400 text-xs py-1">{msg}</li>
      ))}
    </ul>
  )
}
