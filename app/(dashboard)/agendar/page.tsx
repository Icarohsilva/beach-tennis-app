// app/(dashboard)/agendar/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import type { Class, ClassSession, Profile } from '@/types'

export default async function AgendarPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const studentProfile = profile as Profile | null
  if (!studentProfile) redirect('/login')

  const { canStudentAttendLevel } = await import('@/lib/utils/levelAccess')

  // Fetch all active classes
  const { data: classes } = await supabase
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (classes ?? []) as Class[]

  // Filter by level + kids
  const availableClasses = allClasses.filter((c) => {
    const levelOk = canStudentAttendLevel(studentProfile.level, c.level)
    const kidsOk = c.type !== 'kids' || studentProfile.is_dependent
    return levelOk && kidsOk
  })

  if (availableClasses.length === 0) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold text-white">Agendar</h1>
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
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-4">🔍</p>
          <p className="font-semibold text-white mb-1">Nenhuma turma disponível</p>
          <p className="text-sm">Não há turmas ativas compatíveis com seu nível.</p>
        </div>
      </div>
    )
  }

  const classIds = availableClasses.map((c) => c.id)
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const in30Str = in30.toISOString().slice(0, 10)

  const adminClient = createAdminClient()

  // Fetch next 30 days of sessions for available classes
  const { data: sessionsRaw } = classIds.length > 0
    ? await adminClient
        .from('class_sessions')
        .select('id, class_id, session_date, status')
        .in('class_id', classIds)
        .gte('session_date', today)
        .lte('session_date', in30Str)
        .eq('status', 'scheduled')
        .order('session_date', { ascending: true })
    : { data: [] }

  const allSessions = (sessionsRaw ?? []) as Pick<ClassSession, 'id' | 'class_id' | 'session_date' | 'status'>[]

  // Next session per class (first occurrence)
  const nextSessionByClass = new Map<string, Pick<ClassSession, 'id' | 'session_date'>>()
  for (const s of allSessions) {
    if (!nextSessionByClass.has(s.class_id)) {
      nextSessionByClass.set(s.class_id, { id: s.id, session_date: s.session_date })
    }
  }

  const nextSessionIds = Array.from(nextSessionByClass.values()).map((s) => s.id)

  // Enrollment counts per class (for spot display)
  const { data: enrollCountsRaw } = classIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id')
        .in('class_id', classIds)
        .eq('is_active', true)
    : { data: [] }

  const countByClass = new Map<string, number>()
  for (const e of (enrollCountsRaw ?? []) as { class_id: string }[]) {
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1)
  }

  // Student's fixed enrollments (to mark as "aluno fixo")
  const { data: studentEnrollmentsRaw } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('is_active', true)

  const enrolledClassIds = new Set(
    (studentEnrollmentsRaw ?? []).map((e: { class_id: string }) => e.class_id),
  )

  // Student's bookings for next sessions
  const { data: studentBookingsRaw } = nextSessionIds.length > 0
    ? await supabase
        .from('session_bookings')
        .select('id, session_id')
        .eq('student_id', user.id)
        .in('session_id', nextSessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookingBySession = new Map<string, string>()
  for (const b of (studentBookingsRaw ?? []) as { id: string; session_id: string }[]) {
    bookingBySession.set(b.session_id, b.id)
  }

  // Confirmed booking counts per next session (capacity)
  const { data: bookedCountsRaw } = nextSessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id')
        .in('session_id', nextSessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookedCountBySession = new Map<string, number>()
  for (const b of (bookedCountsRaw ?? []) as { session_id: string }[]) {
    bookedCountBySession.set(b.session_id, (bookedCountBySession.get(b.session_id) ?? 0) + 1)
  }

  // Attendees per next session (names)
  const { data: sessionAttendeesRaw } = nextSessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id, profiles(full_name)')
        .in('session_id', nextSessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const sessionAttendeesMap: Record<string, string[]> = {}
  for (const b of (sessionAttendeesRaw ?? []) as { session_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (p?.full_name) {
      sessionAttendeesMap[b.session_id] = [...(sessionAttendeesMap[b.session_id] ?? []), p.full_name]
    }
  }

  // Fixed enrollment attendees per class (shown when no session bookings yet)
  const { data: enrollAttendeesRaw } = classIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id, profiles(full_name)')
        .in('class_id', classIds)
        .eq('is_active', true)
    : { data: [] }

  const classAttendeesMap: Record<string, string[]> = {}
  for (const e of (enrollAttendeesRaw ?? []) as { class_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    if (p?.full_name) {
      classAttendeesMap[e.class_id] = [...(classAttendeesMap[e.class_id] ?? []), p.full_name]
    }
  }

  // Student's waitlist entries for next sessions
  const { data: studentWaitlistRaw } = nextSessionIds.length > 0
    ? await supabase
        .from('waitlists')
        .select('id, session_id, position, status, notified_at')
        .eq('student_id', user.id)
        .in('session_id', nextSessionIds)
        .in('status', ['waiting', 'offered'])
    : { data: [] }

  const waitlistBySession: Record<string, { id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }> = {}
  for (const w of (studentWaitlistRaw ?? []) as { id: string; session_id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }[]) {
    waitlistBySession[w.session_id] = w
  }

  // Waitlist counts per next session
  const { data: waitlistCountsRaw } = nextSessionIds.length > 0
    ? await adminClient
        .from('waitlists')
        .select('session_id')
        .in('session_id', nextSessionIds)
        .in('status', ['waiting', 'offered'])
    : { data: [] }

  const waitlistCountBySession = new Map<string, number>()
  for (const w of (waitlistCountsRaw ?? []) as { session_id: string }[]) {
    waitlistCountBySession.set(w.session_id, (waitlistCountBySession.get(w.session_id) ?? 0) + 1)
  }

  // Student's daily booking counts (for 2/day limit check)
  const nextSessionDates = Array.from(nextSessionByClass.values()).map((s) => s.session_date)
  const dailyBookingCountByDate: Record<string, number> = {}

  if (nextSessionDates.length > 0) {
    const allSessionIdsForDates = allSessions
      .filter((s) => nextSessionDates.includes(s.session_date))
      .map((s) => s.id)

    if (allSessionIdsForDates.length > 0) {
      const { data: allBookingsForDates } = await supabase
        .from('session_bookings')
        .select('session_id')
        .eq('student_id', user.id)
        .in('session_id', allSessionIdsForDates)
        .eq('status', 'confirmed')

      const bookedSessionIds = new Set(
        (allBookingsForDates ?? []).map((b: { session_id: string }) => b.session_id),
      )
      for (const s of allSessions) {
        if (bookedSessionIds.has(s.id)) {
          dailyBookingCountByDate[s.session_date] = (dailyBookingCountByDate[s.session_date] ?? 0) + 1
        }
      }
    }
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

      <div className="space-y-4">
        {availableClasses.map((c) => {
          const nextSession = nextSessionByClass.get(c.id) ?? null
          const nextId = nextSession?.id
          const isEnrolled = enrolledClassIds.has(c.id)
          const bookingId = nextId ? bookingBySession.get(nextId) : undefined
          const hasBooking = !!bookingId
          const sessionBookedCount = nextId ? (bookedCountBySession.get(nextId) ?? 0) : 0
          const sessionWaitlistCount = nextId ? (waitlistCountBySession.get(nextId) ?? 0) : 0
          const waitlistEntry = nextId ? (waitlistBySession[nextId] ?? null) : null

          // Attendees: session bookings take priority, fall back to enrolled students
          const attendees = nextId && sessionAttendeesMap[nextId]?.length
            ? sessionAttendeesMap[nextId]
            : (classAttendeesMap[c.id] ?? [])

          const dailyBookingCount = nextSession
            ? (dailyBookingCountByDate[nextSession.session_date] ?? 0)
            : 0

          return (
            <div key={c.id} className="space-y-1">
              <ClassCard class_={c} enrolledCount={countByClass.get(c.id) ?? 0} />
              <AgendarClient
                class_={c}
                nextSession={nextSession}
                isEnrolled={isEnrolled}
                hasBooking={hasBooking}
                bookingId={bookingId}
                sessionBookedCount={sessionBookedCount}
                sessionWaitlistCount={sessionWaitlistCount}
                waitlistEntry={waitlistEntry}
                attendees={attendees}
                dailyBookingCount={dailyBookingCount}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
