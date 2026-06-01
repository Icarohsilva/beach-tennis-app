'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { bookDayUse, cancelDayUseBooking } from './actions'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
  myBookingId: string | null
}

export function DayUseBookingCard({ slot, bookingsCount, myBookingId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(myBookingId)
  const [localCount, setLocalCount] = useState(bookingsCount)
  const isFull = localCount >= slot.capacity

  async function handleBook() {
    setLoading(true)
    setError(null)
    const result = await bookDayUse(slot.id)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setLocalCount((c) => c + 1)
    setBookingId('pending')
  }

  async function handleCancel() {
    if (!bookingId || bookingId === 'pending') return
    setLoading(true)
    setError(null)
    const result = await cancelDayUseBooking(bookingId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setBookingId(null)
    setLocalCount((c) => Math.max(0, c - 1))
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
              Quadra {slot.court}
            </span>
            <span className="text-xs bg-green-900/40 text-green-300 border border-green-700/50 px-2 py-0.5 rounded-full">
              Day Use · Gratuito
            </span>
            {isFull && !bookingId && <Badge variant="danger">Lotado</Badge>}
          </div>
          <p className="text-white text-sm font-medium">
            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </p>
          {slot.notes && <p className="text-slate-400 text-xs mt-0.5">{slot.notes}</p>}
          <p className="text-slate-500 text-xs mt-1">
            {localCount}/{slot.capacity} reservas
          </p>
        </div>
        <div className="shrink-0">
          {bookingId ? (
            <div className="flex flex-col items-end gap-1">
              <Badge variant="success">Reservado</Badge>
              {bookingId !== 'pending' && (
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
          ) : (
            <Button size="sm" disabled={loading || isFull} onClick={handleBook}>
              {loading ? '...' : 'Reservar'}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </Card>
  )
}
