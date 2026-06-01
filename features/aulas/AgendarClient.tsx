'use client'
// features/aulas/AgendarClient.tsx

import { useState } from 'react'
import { BookingForm } from './BookingForm'
import { bookSession } from './actions'
import { Button } from '@/components/ui/Button'
import type { Class, ClassSession, StudentLevel } from '@/types'

interface AgendarClientProps {
  class_: Class
  sessions: ClassSession[]
  studentId: string
  studentLevel: StudentLevel
  isDependent: boolean
  dailyBookingCounts: Record<string, number>
}

export function AgendarClient({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
}: AgendarClientProps) {
  const [expanded, setExpanded] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleBook(sessionId: string): Promise<{ error?: string }> {
    const result = await bookSession(sessionId)
    if (!result.error) {
      setSuccess(true)
      setExpanded(false)
    }
    return result
  }

  if (success) {
    return (
      <div className="px-1 py-2">
        <p className="text-xs text-green-400">Agendamento confirmado!</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSuccess(false)}
          className="mt-1"
        >
          Agendar outra sessão
        </Button>
      </div>
    )
  }

  return (
    <div className="px-1">
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
