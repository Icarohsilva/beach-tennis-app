'use client'
// features/aulas/AttendanceSheet.tsx

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { Profile, Membership, Attendance, AttendanceSource } from '@/types'

interface StudentAttendance {
  // id/full_name = identidade (profiles); level/payment_type = por-academia (membership).
  student: Pick<Profile, 'id' | 'full_name'> & Pick<Membership, 'level' | 'payment_type'>
  attendance: Attendance | null
}

interface AttendanceSheetProps {
  sessionId: string
  students: StudentAttendance[]
  onMark: (sessionId: string, studentId: string, present: boolean) => Promise<{ error?: string }>
}

const SOURCE_LABEL: Record<AttendanceSource, string> = {
  manual: 'Manual',
  wellhub: 'Wellhub',
  totalpass: 'Totalpass',
}

const SOURCE_VARIANT: Record<AttendanceSource, 'default' | 'success' | 'warning'> = {
  manual: 'default',
  wellhub: 'success',
  totalpass: 'warning',
}

export function AttendanceSheet({ sessionId, students, onMark }: AttendanceSheetProps) {
  const [attendanceMap, setAttendanceMap] = useState<
    Map<string, { status: 'present' | 'absent'; source: AttendanceSource }>
  >(() => {
    const map = new Map()
    for (const s of students) {
      if (s.attendance) {
        map.set(s.student.id, {
          status: s.attendance.status === 'late' ? 'present' : s.attendance.status,
          source: s.attendance.source,
        })
      }
    }
    return map
  })

  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [isPending, startTransition] = useTransition()

  function handleToggle(studentId: string) {
    const current = attendanceMap.get(studentId)
    const newPresent = current?.status !== 'present'

    startTransition(async () => {
      const result = await onMark(sessionId, studentId, newPresent)
      if (result.error) {
        setErrors((prev) => new Map(prev).set(studentId, result.error!))
        return
      }
      setErrors((prev) => {
        const next = new Map(prev)
        next.delete(studentId)
        return next
      })
      setAttendanceMap((prev) => {
        const next = new Map(prev)
        next.set(studentId, { status: newPresent ? 'present' : 'absent', source: 'manual' })
        return next
      })
    })
  }

  const presentCount = Array.from(attendanceMap.values()).filter((a) => a.status === 'present').length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>{students.length} alunos inscritos</span>
        <span className="text-green-400">{presentCount} presentes</span>
      </div>

      {students.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-6">Nenhum aluno inscrito nesta sessão.</p>
      ) : (
        <ul className="space-y-2">
          {students.map(({ student }) => {
            const att = attendanceMap.get(student.id)
            const isPresent = att?.status === 'present'
            const source = att?.source ?? null
            const err = errors.get(student.id)

            return (
              <li
                key={student.id}
                className={[
                  'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors',
                  isPresent
                    ? 'border-green-500/50 bg-green-500/10'
                    : 'border-surface-border bg-surface-card',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{student.full_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {source && (
                      <Badge variant={SOURCE_VARIANT[source]}>{SOURCE_LABEL[source]}</Badge>
                    )}
                  </div>
                  {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
                </div>

                <Button
                  variant={isPresent ? 'primary' : 'secondary'}
                  size="sm"
                  loading={isPending}
                  onClick={() => handleToggle(student.id)}
                  className="shrink-0"
                >
                  {isPresent ? 'Presente ✓' : 'Ausente'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
