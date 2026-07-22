// features/relatorios/query.ts
import { createAdminClient } from '@/lib/supabase/server'
import {
  buildAttendanceReport,
  ATTENDANCE_TRACKING_START,
  type ReportSession,
  type ReportEnrollment,
  type ReportBooking,
  type ReportAttendance,
  type StudentTotals,
} from '@/lib/utils/attendanceReport'
import type { DateWindow } from '@/lib/utils/monthWindow'

export interface FrequencyRow extends StudentTotals {
  name: string
}

export interface UnrecordedSession {
  id: string
  date: string
  className: string
}

export interface FrequencyReport {
  rows: FrequencyRow[]
  /** Aulas que contaram no período. */
  sessionsCount: number
  /** Aulas do período em que ninguém foi marcado — onde o professor deve olhar. */
  unrecorded: UnrecordedSession[]
  totals: { present: number; absent: number; notified: number; rate: number }
}

/** Só conta a partir de quando a academia existe — e do corte global. */
function effectiveStart(orgCreatedAt: string | null): string {
  const orgDay = (orgCreatedAt ?? '').slice(0, 10)
  return orgDay > ATTENDANCE_TRACKING_START ? orgDay : ATTENDANCE_TRACKING_START
}

export async function getFrequencyReport(
  orgId: string,
  window: DateWindow,
  today: string,
): Promise<FrequencyReport> {
  const admin = createAdminClient()

  const [{ data: orgRow }, { data: sessionsRaw }, { data: enrollRaw }] = await Promise.all([
    admin.from('organizations').select('created_at').eq('id', orgId).single(),
    admin
      .from('class_sessions')
      .select('id, session_date, status, class_id, classes(name)')
      .eq('organization_id', orgId)
      .gte('session_date', window.from)
      .lte('session_date', window.to),
    // Sem filtro de is_active: uma matrícula encerrada ainda valia nas aulas
    // anteriores ao cancelamento.
    admin
      .from('enrollments')
      .select('student_id, class_id, enrolled_at, cancelled_at')
      .eq('organization_id', orgId),
  ])

  type SessionRow = {
    id: string
    session_date: string
    status: ReportSession['status']
    class_id: string
    classes: { name: string } | { name: string }[] | null
  }
  const sessionRows = (sessionsRaw ?? []) as unknown as SessionRow[]
  const classNameOf = (row: SessionRow) => {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
    return cls?.name ?? 'Turma'
  }

  const sessions: ReportSession[] = sessionRows.map((row) => ({
    id: row.id,
    date: row.session_date,
    status: row.status,
    classId: row.class_id,
  }))
  const sessionIds = sessions.map((s) => s.id)

  const [{ data: bookingsRaw }, { data: attendanceRaw }] = sessionIds.length > 0
    ? await Promise.all([
        admin.from('session_bookings').select('student_id, session_id, status').in('session_id', sessionIds),
        admin.from('attendance').select('student_id, session_id, status').in('session_id', sessionIds),
      ])
    : [{ data: [] }, { data: [] }]

  const enrollments: ReportEnrollment[] = (
    (enrollRaw ?? []) as { student_id: string; class_id: string; enrolled_at: string; cancelled_at: string | null }[]
  ).map((e) => ({
    studentId: e.student_id,
    classId: e.class_id,
    enrolledAt: (e.enrolled_at ?? '').slice(0, 10),
    cancelledAt: e.cancelled_at ? e.cancelled_at.slice(0, 10) : null,
  }))

  const bookings = ((bookingsRaw ?? []) as { student_id: string; session_id: string; status: string }[])
    .filter((b) => b.status === 'confirmed' || b.status === 'cancelled')
    .map((b) => ({ studentId: b.student_id, sessionId: b.session_id, status: b.status as ReportBooking['status'] }))

  const attendance = ((attendanceRaw ?? []) as { student_id: string; session_id: string; status: string }[])
    .map((a) => ({ studentId: a.student_id, sessionId: a.session_id, status: a.status as ReportAttendance['status'] }))

  const trackingStart = effectiveStart(orgRow?.created_at ?? null)
  const totals = buildAttendanceReport({
    sessions, enrollments, bookings, attendance, today, trackingStart,
  })

  // Nomes só de quem apareceu na conta.
  const ids = totals.map((t) => t.studentId)
  const { data: profiles } = ids.length > 0
    ? await admin.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )

  const rows: FrequencyRow[] = totals.map((t) => ({ ...t, name: nameById.get(t.studentId) ?? 'Aluno' }))

  const counted = sessions.filter(
    (s) => s.status !== 'cancelled' && s.date < today && s.date >= trackingStart,
  )
  const markedSessionIds = new Set(attendance.map((a) => a.sessionId))
  const unrecorded: UnrecordedSession[] = counted
    .filter((s) => !markedSessionIds.has(s.id))
    .map((s) => {
      const row = sessionRows.find((r) => r.id === s.id)!
      return { id: s.id, date: s.date, className: classNameOf(row) }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const present = rows.reduce((sum, r) => sum + r.present, 0)
  const absent = rows.reduce((sum, r) => sum + r.absent, 0)
  const notified = rows.reduce((sum, r) => sum + r.notified, 0)
  const denominator = present + absent + notified

  return {
    rows,
    sessionsCount: counted.length,
    unrecorded,
    totals: {
      present, absent, notified,
      rate: denominator === 0 ? 0 : Math.round((present / denominator) * 100),
    },
  }
}
