// app/(dashboard)/home/page.tsx
// force-dynamic explícito: o puxar-para-atualizar do app (PullToRefresh) chama
// router.refresh() e precisa que este RSC seja sempre rebuscado, nunca servido
// de cache — senão o gesto anima mas devolve os mesmos dados.
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getActiveMembership, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { addDaysISO } from '@/lib/utils/agenda'
import { mergeSessionAttendees, type AttendeeRef } from '@/lib/utils/attendees'
import { HeroHeader } from '@/features/home/HeroHeader'
import { NextClassSpotlight, type SpotlightCandidate } from '@/features/home/NextClassSpotlight'
import { WeekAgenda, type AgendaSession } from '@/features/home/WeekAgenda'
import { SelfCheckinCard, type SelfCheckinCandidate } from '@/features/home/SelfCheckinCard'
import { SelfCheckinModal } from '@/features/home/SelfCheckinModal'
import { getSelfCheckinViews } from '@/features/checkin/selfCheckinQueries'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { computeProgress } from '@/lib/checkin/progress'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import { countDistinctCheckinDays } from '@/lib/checkin/monthlyProgress'
import {
  summarizeMissedCheckins,
  type MissedCheckinSummary,
} from '@/lib/checkin/missedCheckins'
import { getMissedCheckinSettings } from '@/features/checkin/missedCheckinSettings'
import { CheckinProgressCard } from '@/components/ui/CheckinProgressCard'
import { getStudentFrequency } from '@/features/relatorios/query'
import { StudentFrequencyCard } from '@/features/relatorios/StudentFrequencyCard'
import { CalendarPlus, Sun } from 'lucide-react'
import { RecommendationBanner } from '@/features/financeiro/RecommendationBanner'
import { PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { getQuotaSnapshot } from '@/features/aulas/quotaUsage'
import { isQuotaEnforced } from '@/features/aulas/quotaSettings'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { Profile, DayUseSlot, Periodicity, MissedCheckinStatus } from '@/types'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function HomePage() {
  const supabase = createClient()
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().slice(0, 10)
  const adminClient = createAdminClient()

  // Campos por-academia vêm da membership da academia ativa; identidade (full_name) de profiles.
  const orgId = await getActiveOrgId()
  const membership = await getActiveMembership()

  // Cota do plano — mesmo retrato exibido em /agendar. Só busca quando a
  // academia ligou a regra e o aluno tem plano ativo (evita 2 queries à toa).
  const plan = orgId ? await getActivePlan(adminClient, user.id, orgId) : null
  const quotaOn = orgId ? await isQuotaEnforced(adminClient, orgId) : false
  const quota =
    quotaOn && plan && orgId
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, brtToday(new Date()))
      : null

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
    { data: nextSessionsData },
    { data: todayDayUseData },
    { count: weeklyClassesCount },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single(),
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
  const showCredits = !membership?.partner
  const isPartner = !!membership?.partner
  // Não mostra o CTA genérico se já existe uma recomendação de plano do admin
  // (mais específica) ou se o aluno já tem plano/pendência em andamento.
  const showPlanCTA = !isPartner && !existingSub && !recRaw
  let checkinProgress: ReturnType<typeof computeProgress> | null = null
  let missedCheckins: MissedCheckinSummary | null = null
  if (isPartner && membership && orgId) {
    // Dias DISTINTOS, não linhas: duas aulas na terça contam 1 pra meta do mês
    // (spec 2026-07-29-checkin-diario-unico).
    const done = await countDistinctCheckinDays(
      adminClient,
      user.id,
      orgId,
      getMonthWindow(new Date()),
    )
    checkinProgress = computeProgress(membership.monthly_checkin_target, done)

    const [{ data: missedRaw }, { blockLimit }] = await Promise.all([
      adminClient
        .from('missed_checkins')
        .select('id, session_date, amount, status')
        .eq('student_id', user.id)
        .eq('organization_id', orgId)
        .eq('status', 'open'),
      getMissedCheckinSettings(adminClient, orgId),
    ])
    const summary = summarizeMissedCheckins(
      ((missedRaw ?? []) as {
        id: string
        session_date: string
        amount: number | string
        status: MissedCheckinStatus
      }[]).map((r) => ({
        id: r.id,
        sessionDate: r.session_date,
        amount: Number(r.amount),
        status: r.status,
      })),
      blockLimit,
    )
    if (summary.openCount > 0) missedCheckins = summary
  }
  const frequencyWindow = getMonthWindow(new Date())
  const frequency = orgId
    ? await getStudentFrequency(orgId, user.id, frequencyWindow, today)
    : null
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

  // ── Matrículas fixas do aluno (usadas na agenda) ──────────────────────────
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
    .select('id, session_date, class_id, classes(name, start_time, end_time, type, sport, max_students)')
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
      | { name: string; start_time: string; end_time: string; type: string; sport: string | null; max_students: number }
      | { name: string; start_time: string; end_time: string; type: string; sport: string | null; max_students: number }[]
      | null
  }
  const weekSessionRows = (weekSessionsRaw ?? []) as unknown as WeekSessionRow[]
  const weekSessionIds = weekSessionRows.map((s) => s.id)

  // Reservas da janela em confirmed E cancelled: a cancelada é o opt-out do
  // aluno fixo ("não venho nesta data") e precisa tirá-lo da lista de presentes.
  const { data: weekBookingsRaw } = weekSessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('id, session_id, student_id, status, from_enrollment, profiles(full_name)')
        .in('session_id', weekSessionIds)
        .in('status', ['confirmed', 'cancelled'])
    : { data: [] }

  type BookingRow = {
    id: string
    session_id: string
    student_id: string
    status: string
    from_enrollment: boolean
    profiles: { full_name: string } | { full_name: string }[] | null
  }

  const bookedBySession = new Map<string, AttendeeRef[]>()
  const optedOutBySession = new Map<string, Set<string>>()
  const myBookingBySession = new Map<string, { id: string; fromEnrollment: boolean }>()
  const weekBookedCount = new Map<string, number>()

  for (const b of (weekBookingsRaw ?? []) as unknown as BookingRow[]) {
    if (b.status === 'confirmed') {
      const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
      bookedBySession.set(b.session_id, [
        ...(bookedBySession.get(b.session_id) ?? []),
        { id: b.student_id, name: p?.full_name ?? 'Aluno' },
      ])
      weekBookedCount.set(b.session_id, (weekBookedCount.get(b.session_id) ?? 0) + 1)
      if (b.student_id === user.id) {
        myBookingBySession.set(b.session_id, { id: b.id, fromEnrollment: b.from_enrollment })
      }
    } else if (b.status === 'cancelled') {
      const set = optedOutBySession.get(b.session_id) ?? new Set<string>()
      set.add(b.student_id)
      optedOutBySession.set(b.session_id, set)
    }
  }

  // Alunos fixos das turmas que aparecem na agenda da semana.
  const rosterClassIds = Array.from(new Set(weekSessionRows.map((s) => s.class_id)))

  const { data: rosterRaw } = rosterClassIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id, student_id, profiles(full_name)')
        .in('class_id', rosterClassIds)
        .eq('is_active', true)
    : { data: [] }

  const enrolledByClass = new Map<string, AttendeeRef[]>()
  for (const e of (rosterRaw ?? []) as unknown as {
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

  // Fila de espera das sessões da semana, em ordem de chegada. A ordem vem de
  // joined_at (a coluna `position` nunca é recalculada, então fica defasada).
  // Erro aqui degrada para fila vazia de propósito: em ambiente sem a tabela
  // `waitlists` a agenda inteira não pode quebrar por causa disso.
  const { data: weekWaitlistRaw } = weekSessionIds.length > 0
    ? await adminClient
        .from('waitlists')
        .select('id, session_id, student_id, joined_at, profiles(full_name)')
        .in('session_id', weekSessionIds)
        .in('status', ['waiting', 'offered'])
        .order('joined_at', { ascending: true })
    : { data: [] }

  const waitlistBySession = new Map<string, string[]>()
  // sessionId → id da MINHA entrada na fila, para conseguir sair pela ficha.
  const myWaitlistBySession = new Map<string, string>()
  for (const w of (weekWaitlistRaw ?? []) as unknown as {
    id: string
    session_id: string
    student_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    const p = Array.isArray(w.profiles) ? w.profiles[0] : w.profiles
    waitlistBySession.set(w.session_id, [
      ...(waitlistBySession.get(w.session_id) ?? []),
      p?.full_name ?? 'Aluno',
    ])
    if (w.student_id === user.id) myWaitlistBySession.set(w.session_id, w.id)
  }

  /** Quem é esperado numa sessão: reservas confirmadas + fixos que não recusaram. */
  function attendeesOf(sessionId: string, classId: string): string[] {
    return mergeSessionAttendees({
      booked: bookedBySession.get(sessionId) ?? [],
      enrolled: enrolledByClass.get(classId) ?? [],
      optedOut: optedOutBySession.get(sessionId) ?? new Set<string>(),
    }).map((a) => a.name)
  }

  // ── Confirmação de presença pelo app ──────────────────────────────────────
  // Só as aulas do próprio aluno interessam: é ele quem confirma.
  const { data: orgSelfCheckinRow } = orgId
    ? await adminClient
        .from('organizations')
        .select('self_checkin_enabled')
        .eq('id', orgId)
        .maybeSingle()
    : { data: null }

  const selfCheckinEnabled =
    (orgSelfCheckinRow as { self_checkin_enabled: boolean } | null)?.self_checkin_enabled ?? false

  const mySessionRefs = weekSessionRows
    .filter((row) => {
      if (myBookingBySession.has(row.id)) return true
      // Fixo sem reserva conta, a menos que tenha avisado que não vem —
      // mesma regra de isStudentExpectedInSession, que a action reaplica.
      if (!enrolledClassIds.has(row.class_id)) return false
      return !optedOutBySession.get(row.id)?.has(user.id)
    })
    .map((row) => {
      const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
      return cls
        ? { id: row.id, date: row.session_date, start: cls.start_time, end: cls.end_time }
        : null
    })
    .filter((s): s is { id: string; date: string; start: string; end: string } => s !== null)

  const selfCheckinViews = orgId
    ? await getSelfCheckinViews(adminClient, {
        orgId,
        studentId: user.id,
        partner: membership?.partner ?? null,
        sessions: mySessionRefs,
        enabled: selfCheckinEnabled,
      })
    : new Map()

  const agendaSessions: AgendaSession[] = weekSessionRows
    .map((row): AgendaSession | null => {
      const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
      if (!cls) return null
      // Kids só aparece para dependentes — mesma regra das turmas de hoje.
      if (cls.type === 'kids' && !membership?.is_dependent) return null
      const myBooking = myBookingBySession.get(row.id)
      return {
        id: row.id,
        date: row.session_date,
        className: cls.name,
        start: cls.start_time,
        end: cls.end_time,
        booked: weekBookedCount.get(row.id) ?? 0,
        capacity: cls.max_students,
        mine: !!myBooking,
        fixed: enrolledClassIds.has(row.class_id),
        kids: cls.type === 'kids',
        sport: cls.sport ?? null,
        attendees: attendeesOf(row.id, row.class_id),
        waitlist: waitlistBySession.get(row.id) ?? [],
        waitlistEntryId: myWaitlistBySession.get(row.id),
        bookingId: myBooking?.id,
        fromEnrollment: myBooking?.fromEnrollment,
        selfCheckin: selfCheckinViews.get(row.id),
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

  // Candidatas ao atalho de confirmação na home. Qual (se alguma) tem a janela
  // aberta é decisão do cliente, pelo relógio do aluno.
  const selfCheckinCandidates: SelfCheckinCandidate[] = mySessions
    .filter((s) => s.selfCheckin)
    .map((s) => ({
      sessionId: s.id,
      className: s.className,
      start: s.start,
      end: s.end,
      view: s.selfCheckin!,
    }))

  return (
    <div className="space-y-5 p-4 pb-24">
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
              ...(quota
                ? [{
                    label: `Aulas do plano ${plan?.cycle === 'weekly' ? 'nesta semana' : 'neste mês'}`,
                    value: `${quota.used}/${quota.limit}`,
                  }]
                : [{ label: 'Nesta semana', value: mySessions.length }]),
            ]}
          />
        </div>
      </Reveal>

      {/* Parceiro (Wellhub/TotalPass) é isento da cota mesmo com plano híbrido
          vinculado — mesma regra de resolveClassAccess. Mostra o "X de Y" pro
          aluno acompanhar, mas nunca o aviso de bloqueio, que não se aplica. */}
      {quota?.remaining === 0 && !isPartner && (
        <Reveal step={1}>
          <p className="text-xs text-brand-400 -mt-2">
            Cota esgotada. Cancele uma aula futura ou compre uma avulsa.
          </p>
        </Reveal>
      )}

      {selfCheckinCandidates.length > 0 && (
        <Reveal step={1}>
          <SelfCheckinCard candidates={selfCheckinCandidates} />
          <SelfCheckinModal candidates={selfCheckinCandidates} />
        </Reveal>
      )}

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

      {/* Check-in que não aconteceu: a academia perdeu o repasse daquela aula.
          Bloqueado ganha o card em destaque; quem só acumulou, a linha discreta —
          mesma gradação do aviso de cota acima. */}
      {missedCheckins && (
        <Reveal step={2}>
          {missedCheckins.blocked ? (
            <Link href="/financeiro" className="group block">
              <div className="sheen relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600 to-brand-800 p-4 shadow-[0_18px_44px_-26px_rgb(var(--brand-600)/0.95)] transition-transform duration-200 group-hover:-translate-y-0.5">
                <div className="relative flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">Agendamento bloqueado</p>
                    <p className="mt-0.5 text-xs text-white/80">
                      {missedCheckins.openCount} check-in
                      {missedCheckins.openCount !== 1 ? 's' : ''} do parceiro em aberto
                      {missedCheckins.openAmount > 0
                        ? ` · ${BRL.format(missedCheckins.openAmount)}`
                        : ''}
                      . Resolva para voltar a agendar.
                    </p>
                  </div>
                  <span className="text-lg text-white transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <Link href="/financeiro" className="block text-xs text-brand-400 hover:text-brand-300">
              {missedCheckins.openCount} check-in
              {missedCheckins.openCount !== 1 ? 's' : ''} do parceiro em aberto
              {missedCheckins.openAmount > 0
                ? ` (${BRL.format(missedCheckins.openAmount)})`
                : ''}
              {missedCheckins.untilBlock !== null && missedCheckins.untilBlock > 0
                ? `. Mais ${missedCheckins.untilBlock} e seu agendamento é bloqueado.`
                : '.'}{' '}
              Resolver →
            </Link>
          )}
        </Reveal>
      )}

      <Reveal step={2}>
        <StudentFrequencyCard totals={frequency} periodLabel={formatDate(today, 'MMMM')} />
      </Reveal>

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

      {/* Agenda da semana — cada aula abre a ficha em modal (ver/entrar/sair). */}
      {agendaSessions.length > 0 && (
        <Reveal step={3} as="section">
          <SectionHeader title="Sua semana" href="/agendar" linkLabel="agendar" />
          <WeekAgenda todayISO={today} sessions={agendaSessions} />
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
        <SectionHeader title="Minhas próximas aulas" />
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
    </div>
  )
}
