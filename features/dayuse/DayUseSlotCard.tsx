'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { deactivateDayUseSlot } from './actions'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
}

export function DayUseSlotCard({ slot, bookingsCount }: Props) {
  const [loading, setLoading] = useState(false)
  const isFull = bookingsCount >= slot.capacity

  async function handleRemove() {
    if (!confirm('Remover este slot de day use?')) return
    setLoading(true)
    await deactivateDayUseSlot(slot.id)
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
            Quadra {slot.court}
          </span>
          {isFull
            ? <Badge variant="danger">Lotado</Badge>
            : <Badge variant="success">Disponível</Badge>
          }
        </div>
        <p className="text-white text-sm font-medium">
          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
        </p>
        {slot.notes && <p className="text-slate-400 text-xs mt-0.5 truncate">{slot.notes}</p>}
        <p className="text-slate-500 text-xs mt-1">{bookingsCount}/{slot.capacity} reservas</p>
      </div>
      <Button variant="danger" size="sm" disabled={loading} onClick={handleRemove}>
        {loading ? '...' : 'Remover'}
      </Button>
    </Card>
  )
}
