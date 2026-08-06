export const dynamic = 'force-dynamic'

// app/(super-admin)/super-admin/[id]/page.tsx
// Visão 360 de uma academia: identificação, cobrança, ativação, uso ao longo
// do tempo, saúde e as ações de ciclo de vida — com a auditoria do que já foi
// feito nessa conta logo abaixo.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  CalendarCheck,
  ExternalLink,
  Mail,
  MapPin,
  UserCog,
  Users,
} from 'lucide-react'
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import {
  daysUntil,
  formatBRL,
  relativeDays,
  tenantHealth,
  tenantMrr,
} from '@/lib/superAdmin/metrics'
import {
  getPlatformSnapshot,
  getTenantUsageSeries,
} from '@/features/super-admin/platformQueries'
import { listAuditLog, type PlatformAuditAction } from '@/features/super-admin/actions'
import { BarSeries } from '@/features/super-admin/BarSeries'
import { HealthPill } from '@/features/super-admin/HealthPill'
import { StatusBadge } from '@/features/super-admin/StatusBadge'
import { OrgLifecycleActions } from '@/features/super-admin/OrgLifecycleActions'
import { BRAND_FILL, BRAND_SOFT_FILL } from '@/features/super-admin/chartPalette'
import { SectionHeader } from '@/components/ui/SectionHeader'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

const AUDIT_LABEL: Record<PlatformAuditAction, string> = {
  suspend_org: 'Academia suspensa',
  reactivate_org: 'Academia reativada',
  extend_trial: 'Trial estendido',
  grant_comp: 'Cortesia concedida',
  revoke_comp: 'Cortesia revogada',
}

export default async function OrgDetailPage({ params }: { params: { id: string } }) {
  const now = new Date()
  const price = PLATFORM_PLAN.priceMonthly

  const [{ tenants }, usage, audit] = await Promise.all([
    getPlatformSnapshot(),
    getTenantUsageSeries(params.id, 8),
    listAuditLog(params.id, 20),
  ])

  const t = tenants.find((x) => x.id === params.id)
  if (!t) notFound()

  const health = tenantHealth(t, now)
  const trialLeft = daysUntil(t.trialEndsAt, now)
  const periodLeft = daysUntil(t.currentPeriodEnd, now)

  return (
    <div className="space-y-6">
      <Link
        href="/super-admin/academias"
        className="inline-flex items-center gap-1 text-sm text-brand-400 transition-colors hover:text-brand-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Academias
      </Link>

      {/* Cabeçalho: identidade + estado em uma linha. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{t.name}</h1>
            <StatusBadge status={t.subStatus} comped={t.isComped} />
            {t.orgStatus === 'suspended' && (
              <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                SUSPENSA
              </span>
            )}
            <HealthPill tier={health.tier} score={health.score} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {[t.city, t.state].filter(Boolean).join('/') || 'Sem localização'}
            </span>
            <span className="inline-flex items-center gap-1">
              <UserCog className="h-3.5 w-3.5" />
              {t.ownerName ?? 'Sem dono'}
            </span>
            {t.ownerEmail && (
              <a
                href={`mailto:${t.ownerEmail}`}
                className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
              >
                <Mail className="h-3.5 w-3.5" />
                {t.ownerEmail}
              </a>
            )}
          </p>
        </div>
        <Link
          href={`/arenas/${t.slug}`}
          target="_blank"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-surface-border"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Página pública
        </Link>
      </header>

      {/* Números da conta. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="MRR" value={formatBRL(tenantMrr(t, price))} hint={t.isComped ? 'Cortesia' : undefined} />
        <MiniStat label="Alunos ativos" value={t.activeStudents} hint={`${t.students} no total`} icon={Users} />
        <MiniStat label="Aulas 30d" value={t.sessions30d} icon={CalendarCheck} />
        <MiniStat label="Presenças 30d" value={t.checkins30d} hint={`Ativa ${relativeDays(t.lastActivityAt, now)}`} />
      </div>

      {/* Sinais de risco, quando existirem. */}
      {health.reasons.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
            Sinais de risco
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {health.reasons.map((r) => (
              <li
                key={r}
                className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200"
              >
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cobrança. */}
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Assinatura da plataforma
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Status">
              <StatusBadge status={t.subStatus} comped={t.isComped} />
            </Row>
            <Row label="Plano">
              {formatBRL(price)}/mês
            </Row>
            <Row label="Fim do trial">
              {fmtDate(t.trialEndsAt)}
              {trialLeft !== null && t.subStatus === 'trialing' && (
                <span className="ml-1 text-xs text-slate-500">
                  ({trialLeft >= 0 ? `faltam ${trialLeft} dias` : `venceu há ${-trialLeft} dias`})
                </span>
              )}
            </Row>
            <Row label="Pago até">
              {fmtDate(t.currentPeriodEnd)}
              {periodLeft !== null && t.subStatus === 'active' && periodLeft >= 0 && (
                <span className="ml-1 text-xs text-slate-500">(faltam {periodLeft} dias)</span>
              )}
            </Row>
            <Row label="Cadastrada em">{fmtDate(t.createdAt)}</Row>
          </dl>
        </section>

        {/* Ativação e time. */}
        <section className="rounded-xl border border-surface-border bg-surface-card p-4">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Ativação
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Onboarding">
              {t.onboardingCompleted ? (
                <span className="text-emerald-300">Concluído</span>
              ) : (
                <span className="text-amber-300">Pendente</span>
              )}
            </Row>
            <Row label="Equipe">{t.staff} {t.staff === 1 ? 'pessoa' : 'pessoas'}</Row>
            <Row label="Alunos">{t.students} cadastrados · {t.activeStudents} ativos</Row>
            <Row label="Última atividade">{relativeDays(t.lastActivityAt, now)}</Row>
            <Row label="Identificador">
              <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-slate-400">{t.slug}</code>
            </Row>
          </dl>
        </section>
      </div>

      {/* Uso ao longo do tempo — duas pequenas-múltiplas, nunca dois eixos. */}
      <section>
        <SectionHeader title="Uso nas últimas 8 semanas" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass rounded-2xl border border-white/[0.07] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Aulas por semana
            </h3>
            <div className="mt-5">
              <BarSeries
                points={usage.map((u) => ({ label: u.label, value: u.sessions }))}
                color={BRAND_FILL}
                emptyLabel="Nenhuma aula nas últimas 8 semanas."
              />
            </div>
          </div>
          <div className="glass rounded-2xl border border-white/[0.07] p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Presenças por semana
            </h3>
            <div className="mt-5">
              <BarSeries
                points={usage.map((u) => ({ label: u.label, value: u.checkins }))}
                color={BRAND_SOFT_FILL}
                emptyLabel="Nenhuma presença nas últimas 8 semanas."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Ações. */}
      <section>
        <SectionHeader title="Ações da plataforma" />
        <div className="rounded-xl border border-surface-border bg-surface-card p-4">
          <OrgLifecycleActions
            orgId={t.id}
            orgStatus={t.orgStatus}
            subStatus={t.subStatus}
            isComped={t.isComped}
          />
        </div>
      </section>

      {/* Auditoria da conta. */}
      <section>
        <SectionHeader title="Histórico de ações" href="/super-admin/auditoria" linkLabel="ver tudo" />
        {audit.entries.length === 0 ? (
          <p className="rounded-xl border border-surface-border bg-surface-card px-4 py-6 text-center text-sm text-slate-500">
            Nenhuma ação registrada nesta academia.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface-card">
            {audit.entries.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-white">
                    {AUDIT_LABEL[e.action] ?? e.action}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(e.created_at).toLocaleString('pt-BR')} ·{' '}
                    {e.actor_name ?? 'plataforma'}
                  </span>
                </div>
                {e.note && <p className="mt-0.5 text-xs text-slate-400">{e.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{children}</dd>
    </div>
  )
}

function MiniStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: typeof Users
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
      </div>
      <p className="mt-1 text-2xl font-extrabold leading-none text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}
