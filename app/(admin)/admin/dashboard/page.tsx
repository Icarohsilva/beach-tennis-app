export const dynamic = 'force-dynamic'

import { createAdminClient, getCurrentOrgId, getStaffContext } from '@/lib/supabase/server'
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TrialCardActions } from './TrialCardActions'
import Link from 'next/link'

export default async function AdminDashboardPage() {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const staff = await getStaffContext()
  const isOwner = staff?.isOwner ?? false
  const today = new Date().toISOString().slice(0, 10)

  const [
    { count: activeStudents },
    { count: todaySessionsCount },
    { count: activeEnrollments },
    { count: todayDayUseCount },
    { data: todaySessions },
    { data: recentTrials },
  ] = await Promise.all([
    // Alunos ativos é por-academia: conta memberships desta org (não profiles,
    // que só reflete a academia padrão do aluno multi-vínculo).
    adminClient.from('memberships').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('contract_active', true).eq('organization_id', orgId),
    adminClient.from('class_sessions').select('id', { count: 'exact', head: true }).eq('session_date', today).eq('status', 'scheduled').eq('organization_id', orgId),
    adminClient.from('enrollments').select('id', { count: 'exact', head: true }).eq('is_active', true).eq('organization_id', orgId),
    adminClient.from('dayuse_slots').select('id', { count: 'exact', head: true }).eq('date', today).eq('is_active', true).eq('organization_id', orgId),
    adminClient.from('class_sessions')
      .select('id, status, class:classes(name, start_time, end_time, level, type)')
      .eq('session_date', today)
      .neq('status', 'cancelled')
      .eq('organization_id', orgId),
    adminClient.from('trial_bookings')
      .select('id, name, phone, email, status, created_at')
      .eq('status', 'pending')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  type SessionRow = {
    id: string
    status: string
    class: { name: string; start_time: string; end_time: string; level: string; type: string } | { name: string; start_time: string; end_time: string; level: string; type: string }[]
  }
  const sessions = (todaySessions ?? []) as unknown as SessionRow[]

  const trials = (recentTrials ?? []) as Array<{ id: string; name: string; phone: string; email: string; status: string; created_at: string }>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* KPI StatCards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Alunos ativos" value={activeStudents ?? 0} />
        <StatCard label="Aulas hoje" value={todaySessionsCount ?? 0} />
        <StatCard label="Matrículas ativas" value={activeEnrollments ?? 0} />
        <StatCard label="Day use hoje" value={todayDayUseCount ?? 0} />
      </div>

      {/* Today's sessions */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">Aulas de Hoje</h2>
          <Link href="/admin/grade" className="text-brand-500 text-sm hover:underline">Ver grade →</Link>
        </div>
        {sessions.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhuma aula hoje.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => {
              const cls = Array.isArray(s.class) ? s.class[0] : s.class
              return (
                <Link key={s.id} href={`/admin/grade/${s.id}`}>
                  <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-white text-sm font-medium truncate">{cls.name}</span>
                      {cls.type === 'kids'
                        ? <Badge variant="kids">KIDS</Badge>
                        : <Badge variant="level">{cls.level.toUpperCase()}</Badge>
                      }
                    </div>
                    <p className="text-xs text-slate-400">{cls.start_time.slice(0,5)} – {cls.end_time.slice(0,5)}</p>
                    <p className="text-xs text-brand-500 mt-1">Fazer chamada →</p>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Pending trials */}
      {trials.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Aulas Experimentais Pendentes</h2>
          <div className="space-y-2">
            {trials.map((t) => (
              <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{t.name}</span>
                    <Badge variant="warning">Pendente</Badge>
                  </div>
                  <p className="text-xs text-slate-400 truncate">{t.phone} · {t.email}</p>
                </div>
                <TrialCardActions trialId={t.id} />
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Quick links */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Ações Rápidas</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {([
            { href: '/admin/grade/nova-turma', label: '+ Nova Turma', area: 'aulas' },
            { href: '/admin/grade/dayuse', label: 'Day Use', area: 'aulas' },
            { href: '/admin/alunos', label: 'Gerenciar Alunos', area: 'alunos' },
            { href: '/admin/financeiro', label: 'Financeiro', area: 'financeiro' },
            { href: '/admin/notificacoes', label: 'Enviar Notificação', area: 'notificacoes' },
            { href: '/admin/torneios', label: 'Torneios', area: 'torneios' },
          ] as { href: string; label: string; area: AdminArea }[])
            .filter((item) => canAccessArea(item.area, isOwner))
            .map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="text-center hover:border-brand-600/50 transition-colors cursor-pointer py-4">
                <span className="text-slate-300 text-sm">{item.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
