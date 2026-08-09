// features/relatorios/query.ts
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllPages, chunk, IN_CHUNK_SIZE } from '@/lib/supabase/paginate'
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

  type SessionRow = {
    id: string
    session_date: string
    status: ReportSession['status']
    class_id: string
    classes: { name: string } | { name: string }[] | null
  }
  type EnrollRow = {
    student_id: string
    class_id: string
    enrolled_at: string
    cancelled_at: string | null
  }

  const [{ data: orgRow }, sessionRows, enrollRows] = await Promise.all([
    admin.from('organizations').select('created_at').eq('id', orgId).single(),
    fetchAllPages(
      (from, to) =>
        admin
          .from('class_sessions')
          .select('id, session_date, status, class_id, classes(name)')
          .eq('organization_id', orgId)
          .gte('session_date', window.from)
          .lte('session_date', window.to)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'relatorios/frequencia:sessions' },
    ) as Promise<SessionRow[]>,
    // Sem filtro de is_active: uma matrícula encerrada ainda valia nas aulas
    // anteriores ao cancelamento. Cresce com o histórico da academia, não com a
    // janela do relatório — é a leitura que estoura o teto primeiro.
    fetchAllPages<EnrollRow>(
      (from, to) =>
        admin
          .from('enrollments')
          .select('student_id, class_id, enrolled_at, cancelled_at')
          .eq('organization_id', orgId)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'relatorios/frequencia:enrollments' },
    ),
  ])
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

  // Reservas e presenças das sessões do período. Dois cuidados: a lista de ids vai
  // na URL (por isso o chunk) e o resultado passa de 1.000 linhas num mês de
  // academia cheia (por isso o fetchAllPages).
  type BySessionRow = { student_id: string; session_id: string; status: string }
  const loadBySession = async (table: 'session_bookings' | 'attendance'): Promise<BySessionRow[]> => {
    const pages = await Promise.all(
      chunk(sessionIds, IN_CHUNK_SIZE).map((ids) =>
        fetchAllPages<BySessionRow>(
          (from, to) =>
            admin
              .from(table)
              .select('student_id, session_id, status')
              .in('session_id', ids)
              .order('id', { ascending: true })
              .range(from, to),
          { label: `relatorios/frequencia:${table}` },
        ),
      ),
    )
    return pages.flat()
  }

  const [bookingsRaw, attendanceRaw] = sessionIds.length > 0
    ? await Promise.all([loadBySession('session_bookings'), loadBySession('attendance')])
    : [[] as BySessionRow[], [] as BySessionRow[]]

  const enrollments: ReportEnrollment[] = enrollRows.map((e) => ({
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
  const profiles = (
    await Promise.all(
      chunk(ids, IN_CHUNK_SIZE).map((slice) =>
        fetchAllPages<{ id: string; full_name: string }>(
          (from, to) =>
            admin
              .from('profiles')
              .select('id, full_name')
              .in('id', slice)
              .order('id', { ascending: true })
              .range(from, to),
          { label: 'relatorios/frequencia:profiles' },
        ),
      ),
    )
  ).flat()
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]))

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

/**
 * Totais de um aluno só, no período. Reusa a mesma regra do painel: o relatório
 * inteiro da academia é calculado e filtrado. Para o porte destas academias
 * (dezenas de alunos) isso é barato e evita uma segunda regra divergindo da
 * primeira.
 */
export async function getStudentFrequency(
  orgId: string,
  studentId: string,
  window: DateWindow,
  today: string,
): Promise<StudentTotals | null> {
  const report = await getFrequencyReport(orgId, window, today)
  return report.rows.find((r) => r.studentId === studentId) ?? null
}
