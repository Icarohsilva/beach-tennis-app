// lib/utils/attendanceReport.ts
// Regra pura do relatório de frequência. Sem React e sem I/O.
//
// A presença é PRESUMIDA: quem era esperado numa aula que já passou conta como
// presente até alguém dizer o contrário. Uma linha de `attendance` (professor ou
// webhook de parceiro) sempre vence a presunção.

/** Data em que a academia passou a ter frequência rastreada. */
export const ATTENDANCE_TRACKING_START = '2026-07-23'

export interface ReportSession {
  id: string
  /** YYYY-MM-DD */
  date: string
  status: 'scheduled' | 'completed' | 'cancelled'
  classId: string
}

export interface ReportEnrollment {
  studentId: string
  classId: string
  /** YYYY-MM-DD */
  enrolledAt: string
  /** YYYY-MM-DD, ou null se a matrícula segue ativa. */
  cancelledAt: string | null
}

export interface ReportBooking {
  studentId: string
  sessionId: string
  status: 'confirmed' | 'cancelled'
}

export interface ReportAttendance {
  studentId: string
  sessionId: string
  status: 'present' | 'absent' | 'late'
}

export interface ReportInput {
  sessions: ReportSession[]
  enrollments: ReportEnrollment[]
  bookings: ReportBooking[]
  attendance: ReportAttendance[]
  /** Data do servidor, YYYY-MM-DD. Aula de hoje ainda não conta. */
  today: string
  /** Corte de rastreio, YYYY-MM-DD. */
  trackingStart: string
}

export interface StudentTotals {
  studentId: string
  present: number
  absent: number
  notified: number
  /** present + absent + notified — as aulas que estavam previstas para ele. */
  expected: number
  /** 0–100, arredondado. */
  rate: number
}

/**
 * A matrícula valia naquela data? A agenda olha `is_active` (presente); o
 * relatório olha o passado e precisa da janela, senão quem entrou hoje ganha
 * falta retroativa e quem saiu continua acumulando.
 */
function enrollmentCovers(enrollment: ReportEnrollment, date: string): boolean {
  if (enrollment.enrolledAt > date) return false
  if (enrollment.cancelledAt !== null && enrollment.cancelledAt <= date) return false
  return true
}

export function buildAttendanceReport(input: ReportInput): StudentTotals[] {
  const { sessions, enrollments, bookings, attendance, today, trackingStart } = input

  // Só aulas que já passaram, não canceladas e dentro do rastreio.
  const eligible = sessions.filter(
    (s) => s.status !== 'cancelled' && s.date < today && s.date >= trackingStart,
  )

  const bookingsBySession = new Map<string, ReportBooking[]>()
  for (const b of bookings) {
    bookingsBySession.set(b.sessionId, [...(bookingsBySession.get(b.sessionId) ?? []), b])
  }

  const attendanceBySession = new Map<string, Map<string, ReportAttendance['status']>>()
  for (const a of attendance) {
    const perSession = attendanceBySession.get(a.sessionId) ?? new Map()
    perSession.set(a.studentId, a.status)
    attendanceBySession.set(a.sessionId, perSession)
  }

  const totals = new Map<string, StudentTotals>()
  const bump = (studentId: string, field: 'present' | 'absent' | 'notified') => {
    const row = totals.get(studentId) ?? {
      studentId, present: 0, absent: 0, notified: 0, expected: 0, rate: 0,
    }
    row[field] += 1
    row.expected += 1
    totals.set(studentId, row)
  }

  for (const session of eligible) {
    const sessionBookings = bookingsBySession.get(session.id) ?? []
    const marks = attendanceBySession.get(session.id) ?? new Map()

    const confirmedIds = sessionBookings
      .filter((b) => b.status === 'confirmed')
      .map((b) => b.studentId)
    const cancelledIds = sessionBookings
      .filter((b) => b.status === 'cancelled')
      .map((b) => b.studentId)
    const fixedIds = enrollments
      .filter((e) => e.classId === session.classId && enrollmentCovers(e, session.date))
      .map((e) => e.studentId)

    const confirmed = new Set(confirmedIds)
    const cancelled = new Set(cancelledIds)

    // Todo mundo que a aula tocava: fixo na janela, reserva confirmada ou aviso.
    // Deduplicamos por array + Set de controle em vez de espalhar Sets: o
    // tsconfig deste projeto não liga downlevelIteration, então espalhar ou
    // iterar um Set quebra o typecheck (TS2802).
    const seen = new Set<string>()
    const involved: string[] = []
    for (const studentId of [...fixedIds, ...confirmedIds, ...cancelledIds]) {
      if (seen.has(studentId)) continue
      seen.add(studentId)
      involved.push(studentId)
    }

    for (const studentId of involved) {
      const mark = marks.get(studentId)
      if (mark) {
        // Afirmação de alguém (professor ou parceiro) vence a presunção.
        bump(studentId, mark === 'absent' ? 'absent' : 'present')
        continue
      }
      // Reserva confirmada vence o aviso: se as duas linhas coexistissem, o banco
      // diz que o aluno está dentro. Ver mergeSessionAttendees em attendees.ts.
      if (cancelled.has(studentId) && !confirmed.has(studentId)) {
        bump(studentId, 'notified')
        continue
      }
      // Esperado e sem registro: presença presumida.
      bump(studentId, 'present')
    }
  }

  return Array.from(totals.values())
    .map((row) => ({
      ...row,
      rate: row.expected === 0 ? 0 : Math.round((row.present / row.expected) * 100),
    }))
    .sort((a, b) => b.rate - a.rate || b.present - a.present || a.studentId.localeCompare(b.studentId))
}
