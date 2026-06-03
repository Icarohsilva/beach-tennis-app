// app/(dashboard)/aulas/page.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
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
        <h1 className="text-xl font-bold text-white mb-4">Minhas Aulas</h1>
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-4">🎾</p>
          <p className="font-semibold text-white mb-1">Sem matrículas</p>
          <p className="text-sm">Você ainda não está matriculado em nenhuma turma fixa.</p>
          <p className="text-xs mt-2">Solicite ao seu professor para te matricular.</p>
        </div>
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
    { data: enrollCountsRaw },
    { data: sessionsRaw },
    { data: enrollAttendeesRaw },
  ] = await Promise.all([
    // Enrollment counts per class (for spot display)
    adminClient
      .from('enrollments')
      .select('class_id')
      .in('class_id', classIds)
      .eq('is_active', true),

    // Next sessions for enrolled classes (next 30 days)
    adminClient
      .from('class_sessions')
      .select('id, class_id, session_date, status')
      .in('class_id', classIds)
      .gte('session_date', today)
      .lte('session_date', in30Str)
      .eq('status', 'scheduled')
      .order('session_date', { ascending: true }),

    // Fixed enrolled attendees per class
    adminClient
      .from('enrollments')
      .select('class_id, profiles(full_name)')
      .in('class_id', classIds)
      .eq('is_active', true),
  ])

  const countByClass = new Map<string, number>()
  for (const e of (enrollCountsRaw ?? []) as { class_id: string }[]) {
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1)
  }

  const allSessions = (sessionsRaw ?? []) as Pick<ClassSession, 'id' | 'class_id' | 'session_date' | 'status'>[]
  const nextSessionByClass = new Map<string, Pick<ClassSession, 'id' | 'session_date'>>()
  for (const s of allSessions) {
    if (!nextSessionByClass.has(s.class_id)) {
      nextSessionByClass.set(s.class_id, { id: s.id, session_date: s.session_date })
    }
  }

  const classAttendeesMap: Record<string, string[]> = {}
  for (const e of (enrollAttendeesRaw ?? []) as { class_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    if (p?.full_name) {
      classAttendeesMap[e.class_id] = [...(classAttendeesMap[e.class_id] ?? []), p.full_name]
    }
  }

  // Session-level data (needs session IDs first)
  const nextSessionIds = Array.from(nextSessionByClass.values()).map((s) => s.id)

  const [
    { data: studentBookingsRaw },
    { data: bookedCountsRaw },
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

    // Total booked count per session (capacity check)
    nextSessionIds.length > 0
      ? adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', nextSessionIds)
          .eq('status', 'confirmed')
      : Promise.resolve({ data: [] }),

    // Attendee names per session
    nextSessionIds.length > 0
      ? adminClient
          .from('session_bookings')
          .select('session_id, profiles(full_name)')
          .in('session_id', nextSessionIds)
          .eq('status', 'confirmed')
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

  const bookedCountBySession = new Map<string, number>()
  for (const b of (bookedCountsRaw ?? []) as { session_id: string }[]) {
    bookedCountBySession.set(b.session_id, (bookedCountBySession.get(b.session_id) ?? 0) + 1)
  }

  const sessionAttendeesMap: Record<string, string[]> = {}
  for (const b of (sessionAttendeesRaw ?? []) as { session_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (p?.full_name) {
      sessionAttendeesMap[b.session_id] = [...(sessionAttendeesMap[b.session_id] ?? []), p.full_name]
    }
  }

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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Minhas Aulas</h1>
        <span className="text-xs text-slate-400">{typedEnrollments.length} matrículas ativas</span>
      </div>

      <div className="space-y-4">
        {typedEnrollments.map((enrollment) => {
          const c = enrollment.class
          const nextSession = nextSessionByClass.get(c.id) ?? null
          const nextId = nextSession?.id
          const bookingId = nextId ? bookingBySession.get(nextId) : undefined
          const hasBooking = !!bookingId
          const sessionBookedCount = nextId ? (bookedCountBySession.get(nextId) ?? 0) : 0
          const sessionWaitlistCount = nextId ? (waitlistCountBySession.get(nextId) ?? 0) : 0
          const waitlistEntry = nextId ? (waitlistBySession[nextId] ?? null) : null
          const attendees = nextId && sessionAttendeesMap[nextId]?.length
            ? sessionAttendeesMap[nextId]
            : (classAttendeesMap[c.id] ?? [])

          return (
            <div key={enrollment.id} className="space-y-1">
              <ClassCard class_={c} enrolledCount={countByClass.get(c.id) ?? 0} />
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
