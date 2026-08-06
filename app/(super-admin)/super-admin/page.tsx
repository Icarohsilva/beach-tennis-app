export const dynamic = 'force-dynamic'

// app/(super-admin)/super-admin/page.tsx
// Visão geral do NEGÓCIO: o que exige ação hoje, depois receita, retenção,
// aquisição e uso da plataforma.
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Repeat,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react'
import { StatCard } from '@/components/ui/StatCard'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Reveal } from '@/components/ui/Reveal'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import {
  attentionQueue,
  cohortRetention,
  formatBRL,
  formatPercent,
  growthSeries,
  platformSummary,
  relativeDays,
  tenantHealth,
  type SubStatus,
} from '@/lib/superAdmin/metrics'
import { getPlatformSnapshot } from '@/features/super-admin/platformQueries'
import { AttentionQueue } from '@/features/super-admin/AttentionQueue'
import { StatusFunnel } from '@/features/super-admin/StatusFunnel'
import { BarSeries } from '@/features/super-admin/BarSeries'
import { CohortTable } from '@/features/super-admin/CohortTable'
import { HealthPill } from '@/features/super-admin/HealthPill'
import { StatusBadge } from '@/features/super-admin/StatusBadge'
import { BRAND_FILL } from '@/features/super-admin/chartPalette'

export default async function SuperAdminHome() {
  const now = new Date()
  const price = PLATFORM_PLAN.priceMonthly
  const { tenants, queues } = await getPlatformSnapshot()

  const s = platformSummary(tenants, price, now)
  const alerts = attentionQueue(tenants, queues, now)
  const growth = growthSeries(tenants, 12, now)
  const cohorts = cohortRetention(tenants, 6, now)

  const statusCounts = (['active', 'trialing', 'past_due', 'canceled', 'none'] as SubStatus[]).map(
    (status) => ({ status, count: tenants.filter((t) => t.subStatus === status).length }),
  )

  // Contas para o time olhar primeiro: pior saúde, ignorando quem já cancelou.
  const watchlist = tenants
    .filter((t) => t.subStatus !== 'canceled')
    .map((t) => ({ t, h: tenantHealth(t, now) }))
    .filter((x) => x.h.tier !== 'saudavel')
    .sort((a, b) => a.h.score - b.h.score)
    .slice(0, 6)

  // Maiores academias por uso — de quem a plataforma mais depende.
  const topAccounts = [...tenants]
    .sort((a, b) => b.activeStudents - a.activeStudents)
    .slice(0, 5)
    .filter((t) => t.activeStudents > 0)

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-bold">Visão geral</h1>
        <p className="text-sm text-slate-400">
          {s.totalTenants} {s.totalTenants === 1 ? 'academia' : 'academias'} na plataforma ·
          plano único de {formatBRL(price)}/mês
        </p>
      </header>

      {/* 1. O que exige ação humana hoje. */}
      <section>
        <SectionHeader title="Precisa de atenção" />
        <AttentionQueue items={alerts} />
      </section>

      {/* 2. Receita. */}
      <section>
        <SectionHeader title="Receita" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="MRR"
            value={formatBRL(s.mrr)}
            hint={`${s.payingTenants} ${s.payingTenants === 1 ? 'conta pagante' : 'contas pagantes'}`}
            icon={CircleDollarSign}
            step={0}
          />
          <StatCard label="ARR" value={formatBRL(s.arr)} hint="MRR × 12" icon={TrendingUp} step={1} />
          <StatCard
            label="ARPA"
            value={formatBRL(s.arpa)}
            hint="Receita média por conta pagante"
            icon={Users}
            step={2}
          />
          <StatCard
            label="Receita em risco"
            value={formatBRL(s.mrrAtRisk)}
            hint={`${s.pastDueTenants} ${s.pastDueTenants === 1 ? 'cobrança falhada' : 'cobranças falhadas'}`}
            icon={AlertTriangle}
            step={3}
            href="/super-admin/academias?status=past_due"
          />
        </div>
        {s.compedTenants > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {s.compedTenants}{' '}
            {s.compedTenants === 1 ? 'conta cortesia está fora' : 'contas cortesia estão fora'} do
            MRR — acesso liberado sem cobrança.
          </p>
        )}
      </section>

      {/* 3. Retenção e conversão. */}
      <section>
        <SectionHeader title="Retenção e conversão" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Retenção 30d"
            value={formatPercent(s.logoRetentionRate30d, 1)}
            hint={`${s.churnedTenants30d} ${s.churnedTenants30d === 1 ? 'cancelamento' : 'cancelamentos'} no período`}
            icon={Repeat}
            step={0}
          />
          <StatCard
            label="Churn 30d"
            value={formatPercent(s.logoChurnRate30d, 1)}
            hint="Sobre a base do início da janela"
            icon={AlertTriangle}
            step={1}
          />
          <StatCard
            label="Conversão de trial"
            value={formatPercent(s.trialConversionRate, 0)}
            hint={
              s.trialConversionBase > 0
                ? `${s.trialConversionBase} ${s.trialConversionBase === 1 ? 'trial encerrado' : 'trials encerrados'}`
                : 'Nenhum trial encerrado ainda'
            }
            icon={UserCheck}
            step={2}
          />
          <StatCard
            label="LTV estimado"
            value={s.ltv === null ? '—' : formatBRL(s.ltv)}
            hint={s.ltv === null ? 'Sem churn no período' : 'ARPA ÷ churn mensal'}
            icon={CircleDollarSign}
            step={3}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="glass rounded-2xl border border-white/[0.07] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Base por status de assinatura
            </h3>
            <div className="mt-3">
              <StatusFunnel slices={statusCounts} />
            </div>
          </div>

          <div className="glass rounded-2xl border border-white/[0.07] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Retenção por safra de entrada
            </h3>
            <div className="mt-3">
              <CohortTable rows={cohorts} />
            </div>
          </div>
        </div>
      </section>

      {/* 4. Aquisição. */}
      <section>
        <SectionHeader title="Aquisição" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="glass rounded-2xl border border-white/[0.07] p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Novas academias por mês
              </h3>
              <span className="text-xs text-slate-500">
                {growth[growth.length - 1]?.acumulado ?? 0} no total
              </span>
            </div>
            <div className="mt-5">
              <BarSeries
                points={growth.map((g) => ({ label: g.label, value: g.novas }))}
                color={BRAND_FILL}
                height={110}
                emptyLabel="Nenhuma academia cadastrada nos últimos 12 meses."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <StatCard
              label="Novas em 30d"
              value={s.newTenants30d}
              hint="Academias cadastradas"
              icon={Building2}
              step={0}
            />
            <StatCard
              label="Trials acabando"
              value={s.trialsEndingIn7d}
              hint="Nos próximos 7 dias"
              icon={CalendarCheck}
              step={1}
              href="/super-admin/academias?status=trialing"
            />
          </div>
        </div>
      </section>

      {/* 5. Uso agregado — a saúde do produto, não do caixa. */}
      <section>
        <SectionHeader title="Uso da plataforma (30 dias)" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Alunos ativos" value={s.totalActiveStudents} icon={Users} step={0} />
          <StatCard label="Aulas realizadas" value={s.totalSessions30d} icon={CalendarCheck} step={1} />
          <StatCard label="Presenças" value={s.totalCheckins30d} icon={UserCheck} step={2} />
          <StatCard
            label="Academias sem uso"
            value={s.inactiveTenants}
            hint="Nenhuma aula nem presença"
            icon={AlertTriangle}
            step={3}
            href="/super-admin/academias?health=risco"
          />
        </div>
      </section>

      {/* 6. Listas de trabalho. */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Reveal step={0} as="div">
          <SectionHeader title="Contas para acompanhar" href="/super-admin/academias?health=risco" linkLabel="ver todas" />
          {watchlist.length === 0 ? (
            <p className="glass rounded-2xl border border-white/[0.07] px-4 py-6 text-center text-sm text-slate-500">
              Toda a base está saudável.
            </p>
          ) : (
            <ul className="glass divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07]">
              {watchlist.map(({ t, h }) => (
                <li key={t.id}>
                  <Link
                    href={`/super-admin/${t.id}`}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white group-hover:text-brand-400">
                        {t.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {h.reasons[0] ?? 'Sem sinal de risco'}
                        {h.reasons.length > 1 ? ` · +${h.reasons.length - 1}` : ''}
                      </p>
                    </div>
                    <HealthPill tier={h.tier} score={h.score} />
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-white" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Reveal>

        <Reveal step={1} as="div">
          <SectionHeader title="Maiores academias" href="/super-admin/academias" linkLabel="ver todas" />
          {topAccounts.length === 0 ? (
            <p className="glass rounded-2xl border border-white/[0.07] px-4 py-6 text-center text-sm text-slate-500">
              Nenhuma academia com aluno ativo ainda.
            </p>
          ) : (
            <ul className="glass divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.07]">
              {topAccounts.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/super-admin/${t.id}`}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white group-hover:text-brand-400">
                        {t.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {t.activeStudents} alunos ativos · {t.sessions30d} aulas em 30d · ativa{' '}
                        {relativeDays(t.lastActivityAt, now)}
                      </p>
                    </div>
                    <StatusBadge status={t.subStatus} comped={t.isComped} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Reveal>
      </section>
    </div>
  )
}
