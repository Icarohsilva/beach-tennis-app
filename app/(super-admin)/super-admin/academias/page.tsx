export const dynamic = 'force-dynamic'

// app/(super-admin)/super-admin/academias/page.tsx
// Lista operacional dos tenants. Os filtros iniciais chegam por query string
// para que os cards e alertas da visão geral abram já no recorte certo.
import { PLATFORM_PLAN } from '@/lib/billing/platformPlan'
import {
  platformSummary,
  formatBRL,
  type HealthTier,
  type SubStatus,
} from '@/lib/superAdmin/metrics'
import { getPlatformSnapshot } from '@/features/super-admin/platformQueries'
import { TenantTable } from '@/features/super-admin/TenantTable'

const STATUSES: SubStatus[] = ['active', 'trialing', 'past_due', 'canceled', 'none']
const TIERS: HealthTier[] = ['saudavel', 'atencao', 'risco']

function parseStatus(v: string | undefined): SubStatus | 'todos' {
  return v && (STATUSES as string[]).includes(v) ? (v as SubStatus) : 'todos'
}

function parseHealth(v: string | undefined): HealthTier | 'todos' {
  return v && (TIERS as string[]).includes(v) ? (v as HealthTier) : 'todos'
}

export default async function AcademiasPage({
  searchParams,
}: {
  searchParams: { status?: string; health?: string }
}) {
  const now = new Date()
  const price = PLATFORM_PLAN.priceMonthly
  const { tenants } = await getPlatformSnapshot()
  const s = platformSummary(tenants, price, now)

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Academias</h1>
          <p className="text-sm text-slate-400">
            {s.totalTenants} {s.totalTenants === 1 ? 'cadastrada' : 'cadastradas'} ·{' '}
            {s.payingTenants} pagantes · {s.trialingTenants} em trial ·{' '}
            {formatBRL(s.mrr)} de MRR
          </p>
        </div>
      </header>

      <TenantTable
        tenants={tenants}
        price={price}
        nowIso={now.toISOString()}
        initialStatus={parseStatus(searchParams.status)}
        initialHealth={parseHealth(searchParams.health)}
      />
    </div>
  )
}
