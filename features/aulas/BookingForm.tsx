'use client'
// features/aulas/BookingForm.tsx

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import type { Class, ClassSession, StudentLevel } from '@/types'

interface BookingFormProps {
  class_: Class
  sessions: ClassSession[]
  studentLevel: StudentLevel
  isDependent: boolean
  /** Number of confirmed bookings per session_date (to enforce ≤2/day) */
  dailyBookingCounts: Record<string, number>
  sessionBookedCounts: Record<string, number>  // NEW
  onBook: (sessionId: string) => Promise<{ error?: string }>
}

export function BookingForm({
  class_: c,
  sessions,
  studentLevel,
  isDependent,
  dailyBookingCounts,
  sessionBookedCounts,  // NEW
  onBook,
}: BookingFormProps) {
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Client-side pre-validation
  const levelOk = canStudentAttendLevel(studentLevel, c.level)
  const kidsOk = c.type !== 'kids' || isDependent

  const canBook = levelOk && kidsOk

  function getSessionWarning(session: ClassSession): string | null {
    if ((sessionBookedCounts[session.id] ?? 0) >= c.max_students) return 'Lotada'
    const count = dailyBookingCounts[session.session_date] ?? 0
    if (count >= 2) return '2 aulas nesse dia'
    return null
  }

  function handleSubmit() {
    if (!selectedSession) return
    setError(null)

    const session = sessions.find((s) => s.id === selectedSession)
    if (session) {
      const dailyCount = dailyBookingCounts[session.session_date] ?? 0
      if (dailyCount >= 2) {
        setError('Você já tem 2 aulas confirmadas nesse dia.')
        return
      }
    }

    startTransition(async () => {
      const result = await onBook(selectedSession)
      if (result.error) {
        setError(result.error)
      }
    })
  }

  if (!canBook) {
    return (
      <div className="mt-3">
        {!levelOk && (
          <p className="text-xs text-red-400">
            Seu nível ({studentLevel}) não permite esta turma (nível {c.level}).
          </p>
        )}
        {!kidsOk && (
          <p className="text-xs text-red-400">
            Esta turma é exclusiva para dependentes (kids).
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-400 font-semibold">Escolha uma sessão:</p>
      <div className="space-y-2">
        {sessions.map((session) => {
          const warning = getSessionWarning(session)
          const isDisabled = warning !== null
          const isSelected = selectedSession === session.id

          return (
            <button
              key={session.id}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && setSelectedSession(session.id)}
              className={[
                'w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors',
                isSelected
                  ? 'border-brand-500 bg-brand-600/20 text-white'
                  : 'border-surface-border bg-surface text-slate-300',
                isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-brand-600/50 cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span>{formatDate(session.session_date, 'EEE, dd/MM/yyyy')}</span>
                {isDisabled && <Badge variant="warning">{warning}</Badge>}
              </div>
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <Button
        variant="primary"
        size="sm"
        loading={isPending}
        disabled={!selectedSession || isPending}
        onClick={handleSubmit}
        className="w-full"
      >
        Confirmar Agendamento
      </Button>
    </div>
  )
}
