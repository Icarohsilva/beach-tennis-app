// app/(dashboard)/agendar/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import type { Class, ClassSession, Profile } from '@/types'

export default async function AgendarPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch student profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const studentProfile = profile as Profile | null
  if (!studentProfile) redirect('/login')

  // Fetch active classes
  const { data: classes } = await supabase
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (classes ?? []) as Class[]

  // Filter classes the student CAN attend (level + kids check)
  const { canStudentAttendLevel } = await import('@/lib/utils/levelAccess')
  const availableClasses = allClasses.filter((c) => {
    const levelOk = canStudentAttendLevel(studentProfile.level, c.level)
    const kidsOk = c.type !== 'kids' || studentProfile.is_dependent
    return levelOk && kidsOk
  })

  // Fetch upcoming sessions for available classes (next 30 days)
  const today = new Date()
  const in30 = new Date()
  in30.setDate(today.getDate() + 30)
  const todayStr = today.toISOString().slice(0, 10)
  const in30Str = in30.toISOString().slice(0, 10)

  const classIds = availableClasses.map((c) => c.id)

  const { data: sessions } =
    classIds.length > 0
      ? await supabase
          .from('class_sessions')
          .select('*')
          .in('class_id', classIds)
          .gte('session_date', todayStr)
          .lte('session_date', in30Str)
          .eq('status', 'scheduled')
          .order('session_date', { ascending: true })
      : { data: [] }

  const allSessions = (sessions ?? []) as ClassSession[]
  const sessionIds = allSessions.map((s) => s.id)

  // Fetch student's existing confirmed bookings in this period (for daily limit)
  const { data: existingBookings } =
    sessionIds.length > 0
      ? await supabase
          .from('session_bookings')
          .select('session_id, status')
          .eq('student_id', user.id)
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  // Build daily confirmed count map: date -> count
  const confirmedSessionIds = new Set(
    (existingBookings ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const dailyBookingCounts: Record<string, number> = {}
  for (const s of allSessions) {
    if (confirmedSessionIds.has(s.id)) {
      dailyBookingCounts[s.session_date] = (dailyBookingCounts[s.session_date] ?? 0) + 1
    }
  }

  // Fetch enrolled_count per class
  const { data: enrollCounts } =
    classIds.length > 0
      ? await supabase
          .from('enrollments')
          .select('class_id')
          .in('class_id', classIds)
          .eq('is_active', true)
      : { data: [] }

  const countByClass = new Map<string, number>()
  for (const e of (enrollCounts ?? []) as { class_id: string }[]) {
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1)
  }

  // Sessions grouped by class
  const sessionsByClass = new Map<string, ClassSession[]>()
  for (const s of allSessions) {
    const arr = sessionsByClass.get(s.class_id) ?? []
    arr.push(s)
    sessionsByClass.set(s.class_id, arr)
  }

  const adminClient = createAdminClient()

  // Fetch confirmed booking attendees per session (adminClient — bypasses RLS to see other students)
  const { data: bookingAttendeesRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id, profiles(full_name)')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const sessionAttendeesMap: Record<string, string[]> = {}
  for (const b of (bookingAttendeesRaw ?? []) as { session_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const profile = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (profile?.full_name) {
      sessionAttendeesMap[b.session_id] = [
        ...(sessionAttendeesMap[b.session_id] ?? []),
        profile.full_name,
      ]
    }
  }

  // Enrollment fallback: fixed students per class (used when no explicit bookings yet)
  const { data: enrollAttendeesRaw } =
    classIds.length > 0
      ? await adminClient
          .from('enrollments')
          .select('class_id, profiles(full_name)')
          .in('class_id', classIds)
          .eq('is_active', true)
      : { data: [] }

  const classAttendeesMap: Record<string, string[]> = {}
  for (const e of (enrollAttendeesRaw ?? []) as { class_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const profile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    if (profile?.full_name) {
      classAttendeesMap[e.class_id] = [
        ...(classAttendeesMap[e.class_id] ?? []),
        profile.full_name,
      ]
    }
  }

  // Session confirmed booking counts — adminClient bypasses RLS
  const { data: sessionBookedCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

  const sessionBookedCounts: Record<string, number> = {}
  for (const b of (sessionBookedCountsRaw ?? []) as { session_id: string }[]) {
    sessionBookedCounts[b.session_id] = (sessionBookedCounts[b.session_id] ?? 0) + 1
  }

  // Student's own waitlist entries — user-scoped client is sufficient
  const { data: studentWaitlistRaw } =
    sessionIds.length > 0
      ? await supabase
          .from('waitlists')
          .select('id, session_id, position, status, notified_at')
          .eq('student_id', user.id)
          .in('session_id', sessionIds)
          .in('status', ['waiting', 'offered'])
      : { data: [] }

  const studentWaitlist: Record<string, { id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }> = {}
  for (const w of (studentWaitlistRaw ?? []) as { id: string; session_id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }[]) {
    studentWaitlist[w.session_id] = w
  }

  // Waitlist counts per session — adminClient to see all students' entries
  const { data: waitlistCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('waitlists')
          .select('session_id')
          .in('session_id', sessionIds)
          .in('status', ['waiting', 'offered'])
      : { data: [] }

  const sessionWaitlistCounts: Record<string, number> = {}
  for (const w of (waitlistCountsRaw ?? []) as { session_id: string }[]) {
    sessionWaitlistCounts[w.session_id] = (sessionWaitlistCounts[w.session_id] ?? 0) + 1
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Agendar</h1>
        <span className="text-xs text-slate-400">Nível {studentProfile.level.toUpperCase()}</span>
      </div>

      <Link
        href="/agendar/dayuse"
        className="flex items-center justify-between bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3 hover:bg-green-900/30 transition-colors"
      >
        <div>
          <p className="text-green-300 text-sm font-medium">Day Use disponível</p>
          <p className="text-green-500/80 text-xs mt-0.5">Reserve uma quadra avulsa →</p>
        </div>
        <span className="text-2xl">🏖️</span>
      </Link>

      {availableClasses.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-4">🔍</p>
          <p className="font-semibold text-white mb-1">Nenhuma turma disponível</p>
          <p className="text-sm">Não há turmas ativas compatíveis com seu nível no momento.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {availableClasses.map((c) => {
            const classSessions = sessionsByClass.get(c.id) ?? []
            return (
              <div key={c.id} className="space-y-1">
                <ClassCard class_={c} enrolledCount={countByClass.get(c.id) ?? 0} />
                {classSessions.length > 0 && (
                  <AgendarClient
                    class_={c}
                    sessions={classSessions}
                    studentId={user.id}
                    studentLevel={studentProfile.level}
                    isDependent={studentProfile.is_dependent}
                    dailyBookingCounts={dailyBookingCounts}
                    sessionBookedCounts={sessionBookedCounts}
                    studentWaitlist={studentWaitlist}
                    sessionWaitlistCounts={sessionWaitlistCounts}
                    sessionAttendeesMap={sessionAttendeesMap}
                    classAttendeesMap={classAttendeesMap}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
