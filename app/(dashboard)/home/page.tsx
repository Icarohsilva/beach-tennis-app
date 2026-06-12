// app/(dashboard)/home/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { canStudentAttendLevel } from '@/lib/utils/levelAccess'
import { StatHeader } from '@/components/ui/StatHeader'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarPlus } from 'lucide-react'
import type { Tournament, Profile, Class, ClassSession, DayUseSlot } from '@/types'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)
  const todayDayOfWeek = new Date().getDay()
  const adminClient = createAdminClient()

  const [
    { data: profileData },
    { data: tournamentsData },
    { data: nextSessionsData },
    { data: todayClassesData },
    { data: todayDayUseData },
    { count: weeklyClassesCount },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, credits_balance, payment_type, level, is_dependent')
      .eq('id', user.id)
      .single(),
    supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .order('date', { ascending: true })
      .limit(3),
    supabase
      .from('session_bookings')
      .select('id, session:class_sessions(id, session_date, class:classes(name, start_time, end_time, level, type))')
      .eq('student_id', user.id)
      .eq('status', 'confirmed')
      .gte('session_date', today)
      .order('session_date', { referencedTable: 'class_sessions', ascending: true })
      .limit(5),
    supabase
      .from('classes')
      .select('*')
      .eq('day_of_week', todayDayOfWeek)
      .eq('is_active', true)
      .order('start_time', { ascending: true }),
    supabase
      .from('dayuse_slots')
      .select('id, court, start_time, end_time, capacity, notes')
      .eq('date', today)
      .eq('is_active', true)
      .order('start_time', { ascending: true }),
    supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('is_active', true),
  ])

  const profile = profileData as Pick<Profile, 'full_name' | 'credits_balance' | 'payment_type' | 'level' | 'is_dependent'> | null
  const tournaments = (tournamentsData ?? []) as Tournament[]
  const showCredits = profile?.payment_type !== 'wellhub' && profile?.payment_type !== 'totalpass'
  const todayDayUse = (todayDayUseData ?? []) as Pick<DayUseSlot, 'id' | 'court' | 'start_time' | 'end_time' | 'capacity' | 'notes'>[]

  type SessionRow = {
    id: string
    session: {
      id: string
      session_date: string
      class: { name: string; start_time: string; end_time: string; level: string; type: string }
    } | {
      id: string
      session_date: string
      class: { name: string; start_time: string; end_time: string; level: string; type: string }
    }[]
  }
  const nextSessions = (nextSessionsData ?? []) as unknown as SessionRow[]

  // Filter today's classes by student level
  const allTodayClasses = (todayClassesData ?? []) as Class[]
  const todayClasses = profile
    ? allTodayClasses.filter((c) => {
        const levelOk = canStudentAttendLevel(profile.level, c.level)
        const kidsOk = c.type !== 'kids' || profile.is_dependent
        return levelOk && kidsOk
      })
    : []

  // ── Fetch action data for today's classes ─────────────────────────────────
  const todayClassIds = todayClasses.map((c) => c.id)

  // Today's sessions for today's classes
  const { data: todaySessionsRaw } = todayClassIds.length > 0
    ? await adminClient
        .from('class_sessions')
        .select('id, class_id, session_date, status')
        .in('class_id', todayClassIds)
        .eq('session_date', today)
        .eq('status', 'scheduled')
    : { data: [] }

  const todaySessions = (todaySessionsRaw ?? []) as Pick<ClassSession, 'id' | 'class_id' | 'session_date' | 'status'>[]
  const nextSessionByClass = new Map<string, Pick<ClassSession, 'id' | 'session_date'>>()
  for (const s of todaySessions) {
    nextSessionByClass.set(s.class_id, { id: s.id, session_date: s.session_date })
  }
  const todaySessionIds = todaySessions.map((s) => s.id)

  // Enrollment counts per class
  const { data: enrollCountsRaw } = todayClassIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id')
        .in('class_id', todayClassIds)
        .eq('is_active', true)
    : { data: [] }

  const countByClass = new Map<string, number>()
  for (const e of (enrollCountsRaw ?? []) as { class_id: string }[]) {
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1)
  }

  // Student's fixed enrollments
  const { data: studentEnrollmentsRaw } = todayClassIds.length > 0
    ? await supabase
        .from('enrollments')
        .select('class_id')
        .eq('student_id', user.id)
        .in('class_id', todayClassIds)
        .eq('is_active', true)
    : { data: [] }

  const enrolledClassIds = new Set(
    (studentEnrollmentsRaw ?? []).map((e: { class_id: string }) => e.class_id),
  )

  // Student's bookings for today's sessions
  const { data: studentBookingsRaw } = todaySessionIds.length > 0
    ? await supabase
        .from('session_bookings')
        .select('id, session_id')
        .eq('student_id', user.id)
        .in('session_id', todaySessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookingBySession = new Map<string, string>()
  for (const b of (studentBookingsRaw ?? []) as { id: string; session_id: string }[]) {
    bookingBySession.set(b.session_id, b.id)
  }

  // Booked counts for today's sessions
  const { data: bookedCountsRaw } = todaySessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id')
        .in('session_id', todaySessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookedCountBySession = new Map<string, number>()
  for (const b of (bookedCountsRaw ?? []) as { session_id: string }[]) {
    bookedCountBySession.set(b.session_id, (bookedCountBySession.get(b.session_id) ?? 0) + 1)
  }

  // Attendees for today's sessions
  const { data: sessionAttendeesRaw } = todaySessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id, profiles(full_name)')
        .in('session_id', todaySessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const sessionAttendeesMap: Record<string, string[]> = {}
  for (const b of (sessionAttendeesRaw ?? []) as { session_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
    if (p?.full_name) {
      sessionAttendeesMap[b.session_id] = [...(sessionAttendeesMap[b.session_id] ?? []), p.full_name]
    }
  }

  // Fixed enrollment attendees per class (fallback when no session)
  const { data: enrollAttendeesRaw } = todayClassIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id, profiles(full_name)')
        .in('class_id', todayClassIds)
        .eq('is_active', true)
    : { data: [] }

  const classAttendeesMap: Record<string, string[]> = {}
  for (const e of (enrollAttendeesRaw ?? []) as { class_id: string; profiles: { full_name: string } | { full_name: string }[] | null }[]) {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    if (p?.full_name) {
      classAttendeesMap[e.class_id] = [...(classAttendeesMap[e.class_id] ?? []), p.full_name]
    }
  }

  // Student's waitlist entries for today's sessions
  const { data: waitlistRaw } = todaySessionIds.length > 0
    ? await supabase
        .from('waitlists')
        .select('id, session_id, position, status, notified_at')
        .eq('student_id', user.id)
        .in('session_id', todaySessionIds)
        .in('status', ['waiting', 'offered'])
    : { data: [] }

  const waitlistBySession: Record<string, { id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }> = {}
  for (const w of (waitlistRaw ?? []) as { id: string; session_id: string; position: number; status: 'waiting' | 'offered'; notified_at: string | null }[]) {
    waitlistBySession[w.session_id] = w
  }

  // Waitlist counts for today's sessions
  const { data: waitlistCountsRaw } = todaySessionIds.length > 0
    ? await adminClient
        .from('waitlists')
        .select('session_id')
        .in('session_id', todaySessionIds)
        .in('status', ['waiting', 'offered'])
    : { data: [] }

  const waitlistCountBySession = new Map<string, number>()
  for (const w of (waitlistCountsRaw ?? []) as { session_id: string }[]) {
    waitlistCountBySession.set(w.session_id, (waitlistCountBySession.get(w.session_id) ?? 0) + 1)
  }

  // Student's confirmed bookings today (for daily limit)
  const { data: allTodaySessionIds } = await adminClient
    .from('class_sessions')
    .select('id')
    .eq('session_date', today)

  const allTodayIds = (allTodaySessionIds ?? []).map((s: { id: string }) => s.id)
  let dailyBookingCount = 0
  if (allTodayIds.length > 0) {
    const { count } = await supabase
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .in('session_id', allTodayIds)
      .eq('status', 'confirmed')
    dailyBookingCount = count ?? 0
  }

  return (
    <div className="p-4 space-y-6 pb-24">
      <StatHeader
        name={profile?.full_name?.split(' ')[0] ?? 'atleta'}
        stats={[
          ...(showCredits
            ? [{ label: 'Créditos', value: profile?.credits_balance ?? 0 }]
            : [{ label: 'Plano', value: profile?.payment_type === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
          { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
          { label: 'Nível', value: (profile?.level ?? '—').toUpperCase() },
        ]}
      />

      {/* Aulas de hoje com ações inline */}
      {todayClasses.length > 0 && (
        <section>
          <SectionHeader title="Aulas de hoje" />
          <div className="space-y-3">
            {todayClasses.map((c) => {
              const nextSession = nextSessionByClass.get(c.id) ?? null
              const nextId = nextSession?.id
              const isEnrolled = enrolledClassIds.has(c.id)
              const bookingId = nextId ? bookingBySession.get(nextId) : undefined
              const hasBooking = !!bookingId
              const sessionBookedCount = nextId ? (bookedCountBySession.get(nextId) ?? 0) : 0
              const sessionWaitlistCount = nextId ? (waitlistCountBySession.get(nextId) ?? 0) : 0
              const waitlistEntry = nextId ? (waitlistBySession[nextId] ?? null) : null
              const attendees = nextId && sessionAttendeesMap[nextId]?.length
                ? sessionAttendeesMap[nextId]
                : (classAttendeesMap[c.id] ?? [])

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
        </section>
      )}

      {/* Day Use hoje */}
      {todayDayUse.length > 0 && (
        <section>
          <SectionHeader title="Day Use hoje" href="/agendar/dayuse" linkLabel="reservar" />
          <div className="space-y-2">
            {todayDayUse.map((slot) => (
              <Link key={slot.id} href="/agendar/dayuse">
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </p>
                      {slot.notes && (
                        <p className="text-xs text-slate-400 mt-0.5 truncate">{slot.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
                        Quadra {slot.court}
                      </span>
                      <span className="text-xs text-slate-400">Day Use · Gratuito</span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Próximas aulas agendadas */}
      <section>
        <SectionHeader title="Minhas Próximas Aulas" href="/aulas" linkLabel="ver todas" />
        {nextSessions.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="Nenhuma aula agendada"
            description="Garanta sua vaga na próxima aula da sua turma."
            ctaHref="/agendar"
            ctaLabel="Agendar agora"
          />
        ) : (
          <div className="space-y-2">
            {nextSessions.map((item) => {
              const session = Array.isArray(item.session) ? item.session[0] : item.session
              const cls = session ? (Array.isArray(session.class) ? session.class[0] : session.class) : null
              if (!session || !cls) return null
              return (
                <Card key={item.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{cls.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(session.session_date, "EEE, dd 'de' MMM")} · {formatTime(cls.start_time)}
                      </p>
                    </div>
                    {cls.type === 'kids'
                      ? <Badge variant="kids">KIDS</Badge>
                      : <Badge variant="level">{cls.level.toUpperCase()}</Badge>
                    }
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {tournaments.length > 0 && (
        <section>
          <SectionHeader title="Próximos Torneios" href="/torneios" />
          <div className="space-y-2">
            {tournaments.map((tournament) => (
              <Link key={tournament.id} href={`/torneios/${tournament.id}`}>
                <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{tournament.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(tournament.date, "dd 'de' MMMM")}
                      </p>
                    </div>
                    <Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
