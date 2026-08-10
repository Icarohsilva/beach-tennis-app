export const dynamic = 'force-dynamic'

import { createAdminClient, getCurrentOrgId, getStaffContext } from '@/lib/supabase/server'
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'
import {
  Users,
  CalendarDays,
  ClipboardCheck,
  Sun,
  PlusCircle,
  UserCog,
  Wallet,
  Megaphone,
  Trophy,
  CalendarPlus,
  Sparkles,
} from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { AdminHero } from '@/features/painel/AdminHero'
import { DayTimeline, type TimelineSession } from '@/features/painel/DayTimeline'
import { OccupancyPanel } from '@/features/painel/OccupancyPanel'
import { TrialCardActions } from './TrialCardActions'
import Link from 'next/link'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { brtToday } from '@/lib/utils/gridSchedule'

export default async function AdminDashboardPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const staff = await getStaffContext()
  const isOwner = staff?.isOwner ?? false
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

  const [
    { count: activeStudents },
    { count: todaySessionsCount },
    { count: activeEnrollments },
    { count: todayDayUseCount },
    { data: todaySessions },
    { data: recentTrials },
    { data: org },
  ] = await Promise.all([
    // Alunos ativos é por-academia: conta memberships desta org (não profiles,
    // que só reflete a academia padrão do aluno multi-vínculo).
    adminClient.from('memberships').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('contract_active', true).eq('organization_id', orgId),
    adminClient.from('class_sessions').select('id', { count: 'exact', head: true }).eq('session_date', today).eq('status', 'scheduled').eq('organization_id', orgId),
    adminClient.from('enrollments').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('organization_id', orgId),
    adminClient.from('dayuse_slots').select('id', { count: 'exact', head: true }).eq('date', today).eq('is_active', true).eq('organization_id', orgId),
    adminClient.from('class_sessions')
      .select('id, status, class:classes(name, start_time, end_time, level, type, max_students)')
      .eq('session_date', today)
      .neq('status', 'cancelled')
      .eq('organization_id', orgId),
    adminClient.from('trial_bookings')
      .select('id, name, phone, email, status, created_at')
      .eq('status', 'pending')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5),
    adminClient.from('organizations').select('name').eq('id', orgId).single(),
  ])

  type SessionRow = {
    id: string
    status: string
    class:
      | { name: string; start_time: string; end_time: string; level: string; type: string; max_students: number }
      | { name: string; start_time: string; end_time: string; level: string; type: string; max_students: number }[]
  }
  const sessions = (todaySessions ?? []) as unknown as SessionRow[]

  // Presenças confirmadas por sessão de hoje — alimenta as barras de ocupação.
  const sessionIds = sessions.map((s) => s.id)
  const { data: bookedRaw } = sessionIds.length > 0
    ? await adminClient
        .from('session_bookings')
        .select('session_id')
        .in('session_id', sessionIds)
        .eq('status', 'confirmed')
    : { data: [] }

  const bookedBySession = new Map<string, number>()
  for (const b of (bookedRaw ?? []) as { session_id: string }[]) {
    bookedBySession.set(b.session_id, (bookedBySession.get(b.session_id) ?? 0) + 1)
  }

  const timeline: TimelineSession[] = sessions
    .map((s) => {
      const cls = Array.isArray(s.class) ? s.class[0] : s.class
      return {
        id: s.id,
        className: cls.name,
        start: cls.start_time,
        end: cls.end_time,
        booked: bookedBySession.get(s.id) ?? 0,
        capacity: cls.max_students,
        kids: cls.type === 'kids',
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start))

  const dayBooked = timeline.reduce((sum, s) => sum + s.booked, 0)
  const dayCapacity = timeline.reduce((sum, s) => sum + s.capacity, 0)
  const byFill = [...timeline].sort(
    (a, b) => b.booked / (b.capacity || 1) - a.booked / (a.capacity || 1),
  )
  const fullest = byFill[0]
    ? { name: byFill[0].className, booked: byFill[0].booked, capacity: byFill[0].capacity }
    : null
  const emptiest = byFill.length > 1
    ? {
        name: byFill[byFill.length - 1].className,
        booked: byFill[byFill.length - 1].booked,
        capacity: byFill[byFill.length - 1].capacity,
      }
    : null

  const trials = (recentTrials ?? []) as Array<{ id: string; name: string; phone: string; email: string; status: string; created_at: string }>

  const pulse = timeline.length === 0
    ? 'Nenhuma aula na agenda de hoje.'
    : `${timeline.length} ${timeline.length === 1 ? 'aula' : 'aulas'} hoje · ${dayBooked} ${dayBooked === 1 ? 'aluno esperado' : 'alunos esperados'}`

  const heroActions = [
    ...(canAccessArea('aulas', isOwner)
      ? [{ href: '/admin/grade', label: 'Ver grade' }, { href: '/admin/grade/nova-turma', label: '+ Nova turma' }]
      : []),
  ]

  const quickActions: { href: string; label: string; area: AdminArea; icon: typeof Users }[] = [
    { href: '/admin/grade/nova-turma', label: 'Nova turma', area: 'aulas', icon: CalendarPlus },
    { href: '/admin/grade/dayuse', label: 'Day Use', area: 'aulas', icon: Sun },
    { href: '/admin/alunos', label: 'Alunos', area: 'alunos', icon: UserCog },
    { href: '/admin/financeiro', label: 'Financeiro', area: 'financeiro', icon: Wallet },
    { href: '/admin/notificacoes', label: 'Notificação', area: 'notificacoes', icon: Megaphone },
    { href: '/admin/torneios', label: 'Torneios', area: 'torneios', icon: Trophy },
  ]

  return (
    <div className="space-y-6">
      <Reveal step={0}>
        <AdminHero orgName={org?.name ?? 'Painel'} pulse={pulse} actions={heroActions} />
      </Reveal>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Alunos ativos" value={activeStudents ?? 0} icon={Users} step={1} href="/admin/alunos" />
        <StatCard label="Aulas hoje" value={todaySessionsCount ?? 0} icon={CalendarDays} step={2} href="/admin/grade" />
        <StatCard label="Matrículas ativas" value={activeEnrollments ?? 0} icon={ClipboardCheck} step={3} href="/admin/grade" />
        <StatCard label="Day use hoje" value={todayDayUseCount ?? 0} icon={Sun} step={4} href="/admin/grade/dayuse" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Reveal step={5} as="section">
          <SectionHeader title="Agenda de hoje" href="/admin/grade" linkLabel="ver grade" />
          {timeline.length === 0 ? (
            <div className="glass rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
              <CalendarDays className="mx-auto h-7 w-7 text-slate-600" />
              <p className="mt-2 text-sm font-semibold text-slate-300">Nenhuma aula hoje</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Crie uma turma ou gere a grade para começar.
              </p>
              <Link
                href="/admin/grade"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white transition-all hover:from-brand-500 hover:to-brand-600 active:scale-[0.98]"
              >
                <PlusCircle className="h-4 w-4" />
                Abrir a grade
              </Link>
            </div>
          ) : (
            <DayTimeline sessions={timeline} />
          )}
        </Reveal>

        <Reveal step={6} as="section">
          <SectionHeader title="Resumo" />
          <div className="space-y-3">
            <OccupancyPanel
              booked={dayBooked}
              capacity={dayCapacity}
              fullest={fullest}
              emptiest={emptiest}
            />

            <div className="glass rounded-2xl border border-white/[0.07] p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Ações rápidas
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {quickActions
                  .filter((item) => canAccessArea(item.area, isOwner))
                  .map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      className="group flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-brand-600/40 hover:bg-white/[0.06]"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-brand-400" />
                      <span className="truncate text-xs font-semibold text-slate-200">{label}</span>
                    </Link>
                  ))}
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {trials.length > 0 && (
        <Reveal step={7} as="section">
          <SectionHeader title="Aulas experimentais pendentes" href="/admin/alunos" linkLabel="ver alunos" />
          <div className="space-y-2">
            {trials.map((t) => (
              <Card key={t.id} glass className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{t.name}</span>
                      <Badge variant="warning">Pendente</Badge>
                    </div>
                    <p className="truncate text-xs text-slate-400">{t.phone} · {t.email}</p>
                  </div>
                </div>
                <TrialCardActions trialId={t.id} />
              </Card>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  )
}
