export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'

export default async function AdminDashboardPage() {
  const adminClient = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [
    { count: totalStudents },
    { count: activeSubscriptions },
    { data: todaySessions },
    { data: recentTrials },
  ] = await Promise.all([
    adminClient.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student').eq('contract_active', true),
    adminClient.from('student_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    adminClient.from('class_sessions')
      .select('id, status, class:classes(name, start_time, end_time, level, type)')
      .eq('session_date', today)
      .neq('status', 'cancelled'),
    adminClient.from('trial_bookings')
      .select('id, name, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  type SessionRow = {
    id: string
    status: string
    class: { name: string; start_time: string; end_time: string; level: string; type: string } | { name: string; start_time: string; end_time: string; level: string; type: string }[]
  }
  const sessions = (todaySessions ?? []) as unknown as SessionRow[]

  const trials = (recentTrials ?? []) as Array<{ id: string; name: string; status: string; created_at: string }>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <p className="text-slate-400 text-xs mb-1">Alunos ativos</p>
          <p className="text-3xl font-bold text-white">{totalStudents ?? 0}</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs mb-1">Assinaturas ativas</p>
          <p className="text-3xl font-bold text-brand-500">{activeSubscriptions ?? 0}</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs mb-1">Aulas hoje</p>
          <p className="text-3xl font-bold text-white">{sessions.length}</p>
        </Card>
        <Card>
          <p className="text-slate-400 text-xs mb-1">Experimentais pendentes</p>
          <p className="text-3xl font-bold text-yellow-400">{trials.length}</p>
        </Card>
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
              <Card key={t.id} className="flex items-center justify-between">
                <span className="text-white text-sm">{t.name}</span>
                <Badge variant="warning">Pendente</Badge>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Quick links */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Ações Rápidas</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { href: '/admin/grade/nova-turma', label: '+ Nova Turma' },
            { href: '/admin/grade/dayuse', label: 'Day Use' },
            { href: '/admin/alunos', label: 'Gerenciar Alunos' },
            { href: '/admin/financeiro', label: 'Financeiro' },
            { href: '/admin/notificacoes', label: 'Enviar Notificação' },
            { href: '/admin/torneios', label: 'Torneios' },
          ].map((item) => (
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
