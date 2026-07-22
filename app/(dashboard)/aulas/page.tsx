// app/(dashboard)/aulas/page.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarX } from 'lucide-react'
import { mergeSessionAttendees, type AttendeeRef } from '@/lib/utils/attendees'
import type { Class, ClassSession, Enrollment } from '@/types'

export default async function AulasPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Student's active enrollments
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('*, class:classes(*)')
    .eq('student_id', user.id)
    .eq('is_active', true)
    .order('class(day_of_week)', { ascending: true })
    .order('class(start_time)', { ascending: true })

  const typedEnrollments = (enrollments ?? []) as (Enrollment & { class: Class })[]
  const classIds = typedEnrollments.map((e) => e.class_id)

  if (classIds.length === 0) {
    return (
      <div className="p-4 pb-24">
        <SectionHeader title="Minhas Aulas" />
        <EmptyState
          icon={CalendarX}
          title="Você ainda não tem aulas"
          ctaHref="/agendar"
          ctaLabel="Agendar aula"
        />
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date()
  in30.setDate(in30.getDate() + 30)
  const in30Str = in30.toISOString().slice(0, 10)
  const adminClient = createAdminClient()

  // All queries in parallel
  const [
    { data: sessionsRaw },
    { data: enrollAttendeesRaw },
  ] = await Promise.all([
    // Next sessions for enrolled classes (next 30 days)
    adminClient
      .from('class_sessions')
      .select('id, class_id, session_date, status')
      .in('class_id', classIds)
      .gte('session_date', today)
      .lte('session_date', in30Str)
      .eq('status', 'scheduled')
      .order('session_date', { ascending: true }),

    // Alunos fixos por turma — servem de lista de presentes e de contagem.
    adminClient
      .from('enrollments')
      .select('class_id, student_id, profiles(full_name)')
      .in('class_id', classIds)
      .eq('is_active', true),
  ])

  const allSessions = (sessionsRaw ?? []) as Pick<ClassSession, 'id' | 'class_id' | 'session_date' | 'status'>[]
  const nextSessionByClass = new Map<string, Pick<ClassSession, 'id' | 'session_date'>>()
  for (const s of allSessions) {
    if (!nextSessionByClass.has(s.class_id)) {
      nextSessionByClass.set(s.class_id, { id: s.id, session_date: s.session_date })
    }
  }

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

  const countByClass = new Map<string, number>()
  enrolledByClass.forEach((people, classId) => countByClass.set(classId, people.length))

  // Session-level data (needs session IDs first)
  const nextSessionIds = Array.from(nextSessionByClass.values()).map((s) => s.id)

  const [
    { data: studentBookingsRaw },
    { data: sessionAttendeesRaw },
    { data: waitlistRaw },
    { data: waitlistCountsRaw },
  ] = await Promise.all([
    // Student's own bookings for these sessions
    nextSessionIds.length > 0
      ? supabase
          .from('session_bookings')
          .select('id, session_id')
          .eq('student_id', user.id)
          .in('session_id', nextSessionIds)
          .eq('status', 'confirmed')
      : Promise.resolve({ data: [] }),

    // Reservas por sessão em confirmed E cancelled: a cancelada é o opt-out do
    // aluno fixo e precisa tirá-lo da lista de presentes.
    nextSessionIds.length > 0
      ? adminClient
          .from('session_bookings')
          .select('session_id, student_id, status, profiles(full_name)')
          .in('session_id', nextSessionIds)
          .in('status', ['confirmed', 'cancelled'])
      : Promise.resolve({ data: [] }),

    // Student's waitlist entries
    nextSessionIds.length > 0
      ? supabase
          .from('waitlists')
          .select('id, session_id, position, status, notified_at')
          .eq('student_id', user.id)
          .in('session_id', nextSessionIds)
          .in('status', ['waiting', 'offered'])
      : Promise.resolve({ data: [] }),

    // Waitlist counts per session
    nextSessionIds.length > 0
      ? adminClient
          .from('waitlists')
          .select('session_id')
          .in('session_id', nextSessionIds)
          .in('status', ['waiting', 'offered'])
      : Promise.resolve({ data: [] }),
  ])

  const bookingBySession = new Map<string, string>()
  for (const b of (studentBookingsRaw ?? []) as { id: string; session_id: string }[]) {
    bookingBySession.set(b.session_id, b.id)
  }

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

  const bookedCountBySession = new Map<string, number>()
  bookedBySession.forEach((people, sessionId) => bookedCountBySession.set(sessionId, people.length))

  const waitlistBySession: Record<string, { id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }> = {}
  for (const w of (waitlistRaw ?? []) as { id: string; session_id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }[]) {
    waitlistBySession[w.session_id] = w
  }

  const waitlistCountBySession = new Map<string, number>()
  for (const w of (waitlistCountsRaw ?? []) as { session_id: string }[]) {
    waitlistCountBySession.set(w.session_id, (waitlistCountBySession.get(w.session_id) ?? 0) + 1)
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      <SectionHeader title="Minhas Aulas" />

      <div className="space-y-4">
        {typedEnrollments.map((enrollment, index) => {
          const c = enrollment.class
          const nextSession = nextSessionByClass.get(c.id) ?? null
          const nextId = nextSession?.id
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

          return (
            <div key={enrollment.id} className="space-y-1">
              <ClassCard class_={c} enrolledCount={countByClass.get(c.id) ?? 0} accent={index === 0} />
              <AgendarClient
                class_={c}
                nextSession={nextSession}
                isEnrolled={true}
                hasBooking={hasBooking}
                bookingId={bookingId}
                sessionBookedCount={sessionBookedCount}
                sessionWaitlistCount={sessionWaitlistCount}
                waitlistEntry={waitlistEntry}
                attendees={attendees}
                dailyBookingCount={0}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
