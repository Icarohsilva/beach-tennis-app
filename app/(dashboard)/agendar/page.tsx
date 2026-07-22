// app/(dashboard)/agendar/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarX } from 'lucide-react'
import { createClient, createAdminClient, getActiveMembership, getActiveOrgId } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import { EmptyState } from '@/components/ui/EmptyState'
import { mergeSessionAttendees, type AttendeeRef } from '@/lib/utils/attendees'
import type { Class, ClassSession } from '@/types'

export default async function AgendarPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Campos por-academia (level, is_dependent) vêm da membership da academia ativa.
  const orgId = await getActiveOrgId()
  const studentProfile = await getActiveMembership()
  if (!studentProfile) redirect('/login')

  // Fetch all active classes
  const { data: classes } = await supabase
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (classes ?? []) as Class[]

  // Filtra apenas por kids (nível não bloqueia mais).
  const availableClasses = allClasses.filter(
    (c) => c.type !== 'kids' || studentProfile.is_dependent,
  )

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
            <p className="text-green-500/80 text-xs mt-0.5">Reserve sua vaga→</p>
          </div>
          <span className="text-2xl">🏖️</span>
        </Link>
        <EmptyState
          icon={CalendarX}
          title="Nenhuma turma disponível"
          description="Não há turmas ativas no momento."
        />
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
    .eq('organization_id', orgId)
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
        .eq('organization_id', orgId)
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

  // Reservas por sessão em confirmed E cancelled: a cancelada é o opt-out do
  // aluno fixo e precisa tirá-lo da lista de presentes.
  const { data: sessionAttendeesRaw } = nextSessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id, student_id, status, profiles(full_name)')
        .in('session_id', nextSessionIds)
        .in('status', ['confirmed', 'cancelled'])
    : { data: [] }

  const bookedBySession = new Map<string, AttendeeRef[]>()
  const optedOutBySession = new Map<string, Set<string>>()
  for (const b of (sessionAttendeesRaw ?? []) as unknown as {
    session_id: string
    student_id: string
    status: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    if (b.status === 'confirmed') {
      const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
      bookedBySession.set(b.session_id, [
        ...(bookedBySession.get(b.session_id) ?? []),
        { id: b.student_id, name: p?.full_name ?? 'Aluno' },
      ])
    } else if (b.status === 'cancelled') {
      const set = optedOutBySession.get(b.session_id) ?? new Set<string>()
      set.add(b.student_id)
      optedOutBySession.set(b.session_id, set)
    }
  }

  // Alunos fixos por turma — somam com as reservas na lista de presentes.
  const { data: enrollAttendeesRaw } = classIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id, student_id, profiles(full_name)')
        .in('class_id', classIds)
        .eq('is_active', true)
    : { data: [] }

  const enrolledByClass = new Map<string, AttendeeRef[]>()
  for (const e of (enrollAttendeesRaw ?? []) as unknown as {
    class_id: string
    student_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    enrolledByClass.set(e.class_id, [
      ...(enrolledByClass.get(e.class_id) ?? []),
      { id: e.student_id, name: p?.full_name ?? 'Aluno' },
    ])
  }

  // Student's waitlist entries for next sessions
  const { data: studentWaitlistRaw } = nextSessionIds.length > 0
    ? await supabase
        .from('waitlists')
        .select('id, session_id, position, status, notified_at')
        .eq('student_id', user.id)
        .eq('organization_id', orgId)
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
        .eq('organization_id', orgId)
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
      <h1 className="text-xl font-bold text-white">Agendar</h1>

      {studentProfile.credits_balance <= 0 && (
        <Link href="/financeiro" className="text-sm text-brand-500 font-medium">
          Sem créditos? Compre uma aula avulsa →
        </Link>
      )}

      <Link
        href="/agendar/dayuse"
        className="flex items-center justify-between bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3 hover:bg-green-900/30 transition-colors"
      >
        <div>
          <p className="text-green-300 text-sm font-medium">Day Use disponível</p>
          <p className="text-green-500/80 text-xs mt-0.5">Reserve um espaço avulso →</p>
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

          const attendees = mergeSessionAttendees({
            booked: nextId ? (bookedBySession.get(nextId) ?? []) : [],
            enrolled: enrolledByClass.get(c.id) ?? [],
            optedOut: (nextId ? optedOutBySession.get(nextId) : undefined) ?? new Set<string>(),
          }).map((a) => a.name)

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
