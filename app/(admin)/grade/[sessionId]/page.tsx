// app/(admin)/grade/[sessionId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { AttendanceSheet } from '@/features/aulas/AttendanceSheet'
import { markAttendance } from '@/features/aulas/actions'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { ClassSession, Profile, Attendance } from '@/types'

interface Props {
  params: { sessionId: string }
}

export default async function SessionDetailPage({ params }: Props) {
  const adminClient = createAdminClient()

  // Fetch session + class
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(*)')
    .eq('id', params.sessionId)
    .single()

  if (!session) notFound()

  const typedSession = session as ClassSession & {
    class: { id: string; name: string; level: string; type: string; start_time: string; end_time: string; max_students: number }
  }
  const cls = Array.isArray(typedSession.class) ? typedSession.class[0] : typedSession.class

  // Fetch confirmed bookings for the session
  const { data: bookings } = await adminClient
    .from('session_bookings')
    .select('student_id')
    .eq('session_id', params.sessionId)
    .eq('status', 'confirmed')

  const studentIds = (bookings ?? []).map((b: { student_id: string }) => b.student_id)

  // Fetch student profiles
  const { data: profiles } =
    studentIds.length > 0
      ? await adminClient
          .from('profiles')
          .select('id, full_name, level, payment_type')
          .in('id', studentIds)
          .order('full_name', { ascending: true })
      : { data: [] }

  // Fetch attendances for this session
  const { data: attendances } =
    studentIds.length > 0
      ? await adminClient
          .from('attendance')
          .select('*')
          .eq('session_id', params.sessionId)
          .in('student_id', studentIds)
      : { data: [] }

  const attendanceByStudent = new Map(
    (attendances ?? []).map((a: Attendance) => [a.student_id, a]),
  )

  const students = (profiles ?? []).map((p: Pick<Profile, 'id' | 'full_name' | 'level' | 'payment_type'>) => ({
    student: p,
    attendance: attendanceByStudent.get(p.id) ?? null,
  }))

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white">{cls.name}</h1>
          {cls.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
          <Badge variant="level">Nível {cls.level}</Badge>
        </div>
        <p className="text-slate-400 text-sm">
          {formatDate(typedSession.session_date)} · {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
        </p>
      </div>

      <AttendanceSheet
        sessionId={params.sessionId}
        students={students}
        onMark={markAttendance}
      />
    </div>
  )
}
