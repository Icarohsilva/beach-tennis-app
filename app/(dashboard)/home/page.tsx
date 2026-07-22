// app/(dashboard)/home/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getActiveMembership, getActiveOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ClassCard } from '@/features/aulas/ClassCard'
import { AgendarClient } from '@/features/aulas/AgendarClient'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { addDaysISO } from '@/lib/utils/agenda'
import { HeroHeader } from '@/features/home/HeroHeader'
import { NextClassSpotlight, type SpotlightCandidate } from '@/features/home/NextClassSpotlight'
import { WeekAgenda, type AgendaSession } from '@/features/home/WeekAgenda'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { computeProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { CheckinProgressCard } from '@/components/ui/CheckinProgressCard'
import { PushOnboardingCard } from '@/components/pwa/PushOnboardingCard'
import { CalendarPlus, Trophy, Sun } from 'lucide-react'
import { getStudentTournamentHome } from '@/features/torneios/studentHome'
import { NextMatchCard } from '@/features/torneios/NextMatchCard'
import { RecommendationBanner } from '@/features/financeiro/RecommendationBanner'
import { PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import type { Tournament, Profile, Class, ClassSession, DayUseSlot, Periodicity } from '@/types'

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)
  const todayDayOfWeek = new Date().getDay()
  const adminClient = createAdminClient()

  // Campos por-academia vêm da membership da academia ativa; identidade (full_name) de profiles.
  const orgId = await getActiveOrgId()
  const membership = await getActiveMembership()

  const { data: recRaw } = await adminClient
    .from('plan_recommendations')
    .select('id, plan_id, billing_option_id, subscription_plans(name), plan_billing_options(periodicity, price)')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .maybeSingle()

  const recPlan = recRaw
    ? ((Array.isArray(recRaw.subscription_plans) ? recRaw.subscription_plans[0] : recRaw.subscription_plans) as { name: string } | null)
    : null
  const recOption = recRaw
    ? ((Array.isArray(recRaw.plan_billing_options) ? recRaw.plan_billing_options[0] : recRaw.plan_billing_options) as { periodicity: Periodicity; price: number } | null)
    : null

  // CTA de assinatura: só para quem não é Wellhub/TotalPass puro (esses não
  // precisam assinar no app) e ainda não tem plano ativo/pendente. Aluno
  // híbrido (parceiro + assinatura própria) cai fora do CTA porque já tem sub.
  const { data: existingSub } = await adminClient
    .from('student_subscriptions')
    .select('id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .maybeSingle()

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
      .select('full_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'open')
      .eq('organization_id', orgId)
      .order('date', { ascending: true })
      .limit(6),
    supabase
      .from('session_bookings')
      .select('id, session:class_sessions(id, session_date, class:classes(name, start_time, end_time, level, type))')
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .eq('status', 'confirmed')
      .gte('session_date', today)
      .order('session_date', { referencedTable: 'class_sessions', ascending: true })
      .limit(5),
    supabase
      .from('classes')
      .select('*')
      .eq('day_of_week', todayDayOfWeek)
      .eq('is_active', true)
      .eq('organization_id', orgId)
      .order('start_time', { ascending: true }),
    supabase
      .from('dayuse_slots')
      .select('id, court, start_time, end_time, capacity, notes')
      .eq('date', today)
      .eq('is_active', true)
      .eq('organization_id', orgId)
      .order('start_time', { ascending: true }),
    supabase
      .from('enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .eq('is_active', true),
  ])

  const profile = profileData as Pick<Profile, 'full_name'> | null
  const tournaments = (tournamentsData ?? []) as Tournament[]
  const { myTournaments, myTournamentIds, nextMatch } = await getStudentTournamentHome({
    orgId,
    userId: user.id,
  })
  const showCredits = !membership?.partner
  const isPartner = !!membership?.partner
  // Não mostra o CTA genérico se já existe uma recomendação de plano do admin
  // (mais específica) ou se o aluno já tem plano/pendência em andamento.
  const showPlanCTA = !isPartner && !existingSub && !recRaw
  let checkinProgress: ReturnType<typeof computeProgress> | null = null
  if (isPartner && membership) {
    const { from, to } = getMonthWindow(new Date())
    const { count } = await adminClient
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .gte('checkin_date', from)
      .lte('checkin_date', to)
    checkinProgress = computeProgress(membership.monthly_checkin_target, count ?? 0)
  }
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

  // Filtra as turmas de hoje apenas por kids (nível não bloqueia mais).
  const allTodayClasses = (todayClassesData ?? []) as Class[]
  const todayClasses = membership
    ? allTodayClasses.filter((c) => c.type !== 'kids' || membership.is_dependent)
    : []

  // ── Matrículas fixas do aluno (usadas na agenda e no bloco de hoje) ───────
  const { data: studentEnrollmentsRaw } = await supabase
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const enrolledClassIds = new Set(
    (studentEnrollmentsRaw ?? []).map((e: { class_id: string }) => e.class_id),
  )

  // ── Agenda dos próximos 7 dias ────────────────────────────────────────────
  const weekEnd = addDaysISO(today, 6)
  const { data: weekSessionsRaw } = await adminClient
    .from('class_sessions')
    .select('id, session_date, class_id, classes(name, start_time, end_time, type, max_students)')
    .eq('organization_id', orgId)
    .gte('session_date', today)
    .lte('session_date', weekEnd)
    .eq('status', 'scheduled')
    .order('session_date', { ascending: true })

  type WeekSessionRow = {
    id: string
    session_date: string
    class_id: string
    classes:
      | { name: string; start_time: string; end_time: string; type: string; max_students: number }
      | { name: string; start_time: string; end_time: string; type: string; max_students: number }[]
      | null
  }
  const weekSessionRows = (weekSessionsRaw ?? []) as unknown as WeekSessionRow[]
  const weekSessionIds = weekSessionRows.map((s) => s.id)

  const [{ data: weekBookedRaw }, { data: myWeekBookingsRaw }] = weekSessionIds.length > 0
    ? await Promise.all([
        adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', weekSessionIds)
          .eq('status', 'confirmed'),
        supabase
          .from('session_bookings')
          .select('session_id')
          .eq('student_id', user.id)
          .eq('organization_id', orgId)
          .in('session_id', weekSessionIds)
          .eq('status', 'confirmed'),
      ])
    : [{ data: [] }, { data: [] }]

  const weekBookedCount = new Map<string, number>()
  for (const b of (weekBookedRaw ?? []) as { session_id: string }[]) {
    weekBookedCount.set(b.session_id, (weekBookedCount.get(b.session_id) ?? 0) + 1)
  }
  const myWeekSessionIds = new Set(
    (myWeekBookingsRaw ?? []).map((b: { session_id: string }) => b.session_id),
  )

  const agendaSessions: AgendaSession[] = weekSessionRows
    .map((row) => {
      const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
      if (!cls) return null
      // Kids só aparece para dependentes — mesma regra das turmas de hoje.
      if (cls.type === 'kids' && !membership?.is_dependent) return null
      return {
        id: row.id,
        date: row.session_date,
        className: cls.name,
        start: cls.start_time,
        end: cls.end_time,
        booked: weekBookedCount.get(row.id) ?? 0,
        capacity: cls.max_students,
        mine: myWeekSessionIds.has(row.id),
        fixed: enrolledClassIds.has(row.class_id),
        kids: cls.type === 'kids',
      }
    })
    .filter((s): s is AgendaSession => s !== null)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))

  // Destaque: as aulas do aluno vêm primeiro; sem nenhuma, oferece as que ainda
  // têm vaga. O card final é escolhido no cliente, pelo relógio do aluno.
  const mySessions = agendaSessions.filter((s) => s.mine || s.fixed)
  const spotlightCandidates: SpotlightCandidate[] = (
    mySessions.length > 0
      ? mySessions.map((s) => ({ ...s, state: 'booked' as const }))
      : agendaSessions
          .filter((s) => s.booked < s.capacity)
          .map((s) => ({ ...s, state: 'available' as const }))
  )
    .slice(0, 6)
    .map(({ id, className, date, start, end, booked, capacity, state }) => ({
      id,
      className,
      date,
      start,
      end,
      booked,
      capacity,
      state,
    }))

  // ── Dados de ação das turmas de hoje ──────────────────────────────────────
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

  // Student's bookings for today's sessions
  const { data: studentBookingsRaw } = todaySessionIds.length > 0
    ? await supabase
        .from('session_bookings')
        .select('id, session_id')
        .eq('student_id', user.id)
        .eq('organization_id', orgId)
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
        .eq('organization_id', orgId)
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
    .eq('organization_id', orgId)

  const allTodayIds = (allTodaySessionIds ?? []).map((s: { id: string }) => s.id)
  let dailyBookingCount = 0
  if (allTodayIds.length > 0) {
    const { count } = await supabase
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', user.id)
      .eq('organization_id', orgId)
      .in('session_id', allTodayIds)
      .eq('status', 'confirmed')
    dailyBookingCount = count ?? 0
  }

  // Bloco de hoje com as ações reais (agendar, fila, sair), injetado na agenda.
  const todayContent = todayClasses.length > 0 ? (
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
  ) : null

  return (
    <div className="space-y-5 p-4 pb-24">
      <PushOnboardingCard />

      {recRaw && (
        <RecommendationBanner
          recommendationId={recRaw.id as string}
          planName={recPlan?.name ?? 'Plano'}
          periodicityLabel={PERIODICITY_LABELS[recOption?.periodicity ?? 'monthly']}
          price={recOption?.price ?? 0}
        />
      )}

      <Reveal step={0}>
        <div data-tour="tour-aluno-progresso">
          <HeroHeader
            name={profile?.full_name?.split(' ')[0] ?? 'atleta'}
            stats={[
              ...(showCredits
                ? [{ label: 'Créditos', value: membership?.credits_balance ?? 0 }]
                : [{ label: 'Plano', value: membership?.partner === 'wellhub' ? 'Wellhub' : 'TotalPass' }]),
              { label: 'Aulas/semana', value: weeklyClassesCount ?? 0 },
              { label: 'Nesta semana', value: mySessions.length },
            ]}
          />
        </div>
      </Reveal>

      {spotlightCandidates.length > 0 && (
        <Reveal step={1}>
          <NextClassSpotlight candidates={spotlightCandidates} todayISO={today} />
        </Reveal>
      )}

      {isPartner && checkinProgress && (
        <Reveal step={2}>
          <CheckinProgressCard
            partner={membership!.partner as 'wellhub' | 'totalpass'}
            progress={checkinProgress}
          />
        </Reveal>
      )}

      {showPlanCTA && (
        <Reveal step={2}>
          <Link href="/financeiro" className="group block">
            <div className="sheen relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-[0_18px_44px_-26px_rgb(var(--brand-600)/0.95)] transition-transform duration-200 group-hover:-translate-y-0.5">
              <div className="relative flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-white">Assine um plano</p>
                  <p className="mt-0.5 text-xs text-white/80">
                    Aulas incluídas todo mês, sem pagar aula avulsa.
                  </p>
                </div>
                <span className="shrink-0 text-xl text-white transition-transform group-hover:translate-x-1">
                  →
                </span>
              </div>
            </div>
          </Link>
        </Reveal>
      )}

      {nextMatch && (
        <Reveal step={3}>
          <NextMatchCard match={nextMatch} />
        </Reveal>
      )}

      {/* Agenda da semana — hoje traz as ações completas de agendamento. */}
      {(agendaSessions.length > 0 || todayContent) && (
        <Reveal step={3} as="section">
          <SectionHeader title="Sua semana" href="/agendar" linkLabel="agendar" />
          <WeekAgenda todayISO={today} sessions={agendaSessions} todayContent={todayContent} />
        </Reveal>
      )}

      {/* Day Use hoje */}
      {todayDayUse.length > 0 && (
        <Reveal step={4} as="section">
          <SectionHeader title="Day Use hoje" href="/agendar/dayuse" linkLabel="reservar" />
          <div className="space-y-2">
            {todayDayUse.map((slot) => (
              <Link key={slot.id} href="/agendar/dayuse" className="group block">
                <Card glass interactive>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                        <Sun className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                        </p>
                        {slot.notes && (
                          <p className="mt-0.5 truncate text-xs text-slate-400">{slot.notes}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-full border border-sky-700/50 bg-sky-900/40 px-2 py-0.5 text-xs text-sky-300">
                        Espaço {slot.court}
                      </span>
                      <span className="text-xs text-slate-400">Day Use · Gratuito</span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {/* Próximas aulas agendadas */}
      <Reveal step={5} as="section">
        <SectionHeader title="Minhas próximas aulas" href="/aulas" linkLabel="ver todas" />
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
                <Card key={item.id} glass>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{cls.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatDate(session.session_date, "EEE, dd 'de' MMM")} · {formatTime(cls.start_time)}
                      </p>
                    </div>
                    {cls.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </Reveal>

      {myTournaments.length > 0 && (
        <Reveal step={6} as="section">
          <SectionHeader title="Meus torneios" href="/torneios" />
          <div className="space-y-2">
            {myTournaments.map((t) => (
              <Link key={t.id} href={`/torneios/${t.id}`} className="group block">
                <Card glass accent interactive>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
                        <Trophy className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{t.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDate(t.date, "dd 'de' MMMM")}
                        </p>
                      </div>
                    </div>
                    <Badge variant={t.status === 'in_progress' ? 'warning' : 'success'}>
                      {t.status === 'in_progress' ? 'Em andamento' : 'Inscrito'}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {tournaments.filter((t) => !myTournamentIds.has(t.id)).length > 0 && (
        <Reveal step={7} as="section">
          <SectionHeader title="Próximos torneios" href="/torneios" />
          <div className="space-y-2">
            {tournaments
              .filter((t) => !myTournamentIds.has(t.id))
              .slice(0, 3)
              .map((tournament) => (
                <Link key={tournament.id} href={`/torneios/${tournament.id}`} className="group block">
                  <Card glass interactive>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{tournament.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDate(tournament.date, "dd 'de' MMMM")}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 transition-colors group-hover:text-brand-400">
                        ver →
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
          </div>
        </Reveal>
      )}
    </div>
  )
}
