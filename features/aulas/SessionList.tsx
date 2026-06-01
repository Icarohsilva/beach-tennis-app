// features/aulas/SessionList.tsx
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { ClassSession, SessionBooking } from '@/types'

interface SessionListProps {
  sessions: ClassSession[]
  bookings: SessionBooking[] // bookings of the current student
  maxDisplay?: number
}

export function SessionList({ sessions, bookings, maxDisplay = 4 }: SessionListProps) {
  const bookingBySession = new Map(bookings.map((b) => [b.session_id, b]))

  const upcoming = sessions
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .slice(0, maxDisplay)

  if (upcoming.length === 0) {
    return (
      <p className="text-slate-500 text-xs py-2">Sem sessões próximas.</p>
    )
  }

  return (
    <ul className="space-y-1 mt-2">
      {upcoming.map((session) => {
        const booking = bookingBySession.get(session.id)
        const isConfirmed = booking?.status === 'confirmed'
        const isCancelled = booking?.status === 'cancelled'

        return (
          <li
            key={session.id}
            className="flex items-center justify-between text-xs text-slate-300 py-1 border-b border-surface-border last:border-0"
          >
            <span>{formatDate(session.session_date, 'EEE, dd/MM')}</span>
            <span>
              {isConfirmed && <Badge variant="success">Confirmado</Badge>}
              {isCancelled && <Badge variant="danger">Cancelado</Badge>}
              {!booking && <Badge variant="default">Sem booking</Badge>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
