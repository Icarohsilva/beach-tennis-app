'use client'
// features/aulas/StartClassClient.tsx

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils/cn'
import { markAttendanceBulk } from './actions'

interface Student {
  student: { id: string; full_name: string }
  wouldOweDebt: boolean
}

interface Props {
  sessionId: string
  students: Student[]
  isCompleted: boolean
}

type Phase = 'idle' | 'calling' | 'done'

export function StartClassClient({ sessionId, students, isCompleted }: Props) {
  const allIds = students.map((s) => s.student.id)
  const [phase, setPhase] = useState<Phase>(isCompleted ? 'done' : 'idle')
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set(allIds))
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggleStudent(id: string) {
    setPresentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function markAllPresent() {
    setPresentIds(new Set(allIds))
  }

  function handleConfirm() {
    setErrorMsg(null)
    startTransition(async () => {
      const result = await markAttendanceBulk(sessionId, allIds, Array.from(presentIds))
      if (result.error) {
        setErrorMsg(result.error)
      } else {
        setPhase('done')
      }
    })
  }

  if (phase === 'done') {
    const presentCount = presentIds.size
    return (
      <div className="rounded-lg bg-green-900/30 border border-green-700 p-4 text-green-300 text-sm">
        Chamada confirmada — {presentCount} aluno{presentCount !== 1 ? 's' : ''} presente{presentCount !== 1 ? 's' : ''}.
      </div>
    )
  }

  if (phase === 'idle') {
    return (
      <div className="pt-2">
        <Button onClick={() => setPhase('calling')} variant="primary">
          Iniciar Aula
        </Button>
      </div>
    )
  }

  // phase === 'calling'
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Chamada</h2>

      <div className="space-y-2">
        {students.map(({ student, wouldOweDebt }) => {
          const present = presentIds.has(student.id)
          return (
            <button
              key={student.id}
              onClick={() => toggleStudent(student.id)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-medium transition-colors',
                present
                  ? 'bg-green-900/40 border-green-600 text-green-300'
                  : 'bg-red-900/40 border-red-700 text-red-300',
              )}
            >
              <span>
                {student.full_name}
                {wouldOweDebt && (
                  <span title="Sem plano/crédito — marcar presença vai gerar dívida"> ⚠️</span>
                )}
              </span>
              <span>{present ? 'Presente' : 'Ausente'}</span>
            </button>
          )
        })}
      </div>

      {students.length === 0 && (
        <p className="text-slate-400 text-sm">Nenhum aluno inscrito nesta sessão.</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={markAllPresent} disabled={isPending}>
          Marcar todos presentes
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={isPending}>
          {isPending ? 'Salvando…' : 'Confirmar Chamada'}
        </Button>
      </div>

      {errorMsg && (
        <p className="text-red-400 text-sm">{errorMsg}</p>
      )}
    </div>
  )
}
