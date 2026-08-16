// features/super-admin/platformQueries.ts
// Camada de leitura CROSS-ORG do painel de plataforma. Sempre service role
// (createAdminClient ignora RLS) e sempre atrás do gate de is_platform_admin —
// quem chama é responsável por rodar requirePlatformAdmin antes.
//
// Nota de escala: as contagens por academia são feitas em memória a partir de
// leituras paginadas, não com um count por org (que seria N+1 de rede). O
// PostgREST corta em 1000 linhas por request, então toda leitura de volume
// passa por fetchAllPages (lib/supabase/paginate.ts). Todas ordenam por `id`:
// sem ordem estável entre páginas o Postgres pode repetir ou pular linha.
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/supabase/paginate'
import type { SubStatus, TenantSnapshot } from '@/lib/superAdmin/metrics'
import type { SubscriptionEvent } from '@/lib/superAdmin/mrrMovement'

type Admin = ReturnType<typeof createAdminClient>

/** Soma +1 no bucket da org. Ignora linhas órfãs (organization_id nulo). */
function tally(map: Map<string, number>, orgId: string | null): void {
  if (!orgId) return
  map.set(orgId, (map.get(orgId) ?? 0) + 1)
}

/** Guarda a data mais recente por org. */
function keepLatest(map: Map<string, string>, orgId: string | null, iso: string | null): void {
  if (!orgId || !iso) return
  const current = map.get(orgId)
  if (!current || iso > current) map.set(orgId, iso)
}

const SUB_COLUMNS = 'organization_id, status, trial_ends_at, current_period_end, updated_at'

/**
 * Assinaturas da plataforma. `is_comped` chega na migration
 * 20260806000000_platform_admin_audit_log.sql; enquanto ela não roda, a coluna
 * não existe e o PostgREST recusa o select INTEIRO. Sem este fallback o painel
 * mostraria a base toda como "sem assinatura" e MRR zero — errado de um jeito
 * que parece verdade. Na segunda tentativa a cortesia cai para is_default.
 */
async function fetchSubscriptions(admin: Admin): Promise<SubRow[]> {
  try {
    return await fetchAllPages<SubRow>(
      (from, to) =>
        admin
          .from('platform_subscriptions')
          .select(`${SUB_COLUMNS}, is_comped`)
          .order('id')
          .range(from, to),
      { label: 'super-admin/platform_subscriptions' },
    )
  } catch {
    return fetchAllPages<SubRow>(
      (from, to) =>
        admin.from('platform_subscriptions').select(SUB_COLUMNS).order('id').range(from, to),
      { label: 'super-admin/platform_subscriptions(sem is_comped)' },
    )
  }
}

export interface PlatformQueueCounts {
  pendingRefunds: number
  pendingDeletions: number
  unreadFeedback: number
}

export interface PlatformSnapshot {
  tenants: TenantSnapshot[]
  queues: PlatformQueueCounts
}

/**
 * Retrato completo da plataforma: uma linha por academia com cobrança,
 * ativação e uso dos últimos 30 dias, mais os contadores das filas operacionais.
 * Tudo em paralelo — o painel inteiro é montado a partir deste retorno.
 *
 * cache() do React: layout, página e detalhe podem pedir o retrato no mesmo
 * request sem repetir as leituras.
 */
export const getPlatformSnapshot = cache(async function getPlatformSnapshot(
  windowDays = 30,
): Promise<PlatformSnapshot> {
  const admin: Admin = createAdminClient()
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const sinceDate = since.slice(0, 10)

  const [
    orgs,
    subs,
    memberships,
    sessions,
    checkins,
    refunds,
    deletions,
    feedback,
  ] = await Promise.all([
    fetchAllPages<OrgRow>(
      (from, to) =>
        admin
          .from('organizations')
          .select('id, name, slug, city, state, owner_id, status, created_at, onboarding_completed, is_default')
          .order('id')
          .range(from, to),
      { label: 'super-admin/organizations' },
    ),
    fetchSubscriptions(admin),
    fetchAllPages<MembershipRow>(
      (from, to) =>
        admin
          .from('memberships')
          .select('organization_id, role, contract_active')
          .order('id')
          .range(from, to),
      { label: 'super-admin/memberships' },
    ),
    // session_date (não created_at): interessa a aula que ACONTECEU na janela.
    fetchAllPages<SessionRow>(
      (from, to) =>
        admin
          .from('class_sessions')
          .select('organization_id, session_date')
          .gte('session_date', sinceDate)
          .neq('status', 'cancelled')
          .order('id')
          .range(from, to),
      { label: 'super-admin/class_sessions' },
    ),
    fetchAllPages<AttendanceRow>(
      (from, to) =>
        admin
          .from('attendance')
          .select('organization_id, checked_in_at')
          .gte('checked_in_at', since)
          .order('id')
          .range(from, to),
      { label: 'super-admin/attendance' },
    ),
    admin
      .from('platform_refund_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente'),
    admin
      .from('account_deletion_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente'),
    admin.from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'novo'),
  ])

  // Donos: nome em profiles, e-mail na view user_emails (service role only).
  const ownerIds = Array.from(new Set(orgs.map((o) => o.owner_id).filter(Boolean))) as string[]
  const [ownerProfiles, ownerEmails] = await Promise.all([
    ownerIds.length
      ? admin.from('profiles').select('id, full_name').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    ownerIds.length
      ? admin.from('user_emails').select('id, email').in('id', ownerIds)
      : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
  ])
  const nameById = new Map(
    ((ownerProfiles.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  )
  const emailById = new Map(
    ((ownerEmails.data ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]),
  )

  const subByOrg = new Map(subs.map((s) => [s.organization_id, s]))

  const students = new Map<string, number>()
  const activeStudents = new Map<string, number>()
  const staff = new Map<string, number>()
  for (const m of memberships) {
    if (m.role === 'student') {
      tally(students, m.organization_id)
      if (m.contract_active) tally(activeStudents, m.organization_id)
    } else {
      tally(staff, m.organization_id)
    }
  }

  const sessions30d = new Map<string, number>()
  const lastActivity = new Map<string, string>()
  for (const s of sessions) {
    tally(sessions30d, s.organization_id)
    // session_date é DATE; normaliza para ISO para comparar com checked_in_at.
    keepLatest(lastActivity, s.organization_id, s.session_date ? `${s.session_date}T00:00:00.000Z` : null)
  }

  const checkins30d = new Map<string, number>()
  for (const c of checkins) {
    tally(checkins30d, c.organization_id)
    keepLatest(lastActivity, c.organization_id, c.checked_in_at)
  }

  const tenants: TenantSnapshot[] = orgs.map((o) => {
    const sub = subByOrg.get(o.id)
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      city: o.city,
      state: o.state,
      ownerName: o.owner_id ? nameById.get(o.owner_id) ?? null : null,
      ownerEmail: o.owner_id ? emailById.get(o.owner_id) ?? null : null,
      orgStatus: o.status,
      subStatus: (sub?.status ?? 'none') as SubStatus,
      trialEndsAt: sub?.trial_ends_at ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      subUpdatedAt: sub?.updated_at ?? null,
      createdAt: o.created_at,
      onboardingCompleted: o.onboarding_completed ?? false,
      // is_default (academia vitalícia) segue valendo como cortesia mesmo se a
      // flag explícita ainda não tiver sido marcada.
      isComped: (sub?.is_comped ?? false) || (o.is_default ?? false),
      students: students.get(o.id) ?? 0,
      activeStudents: activeStudents.get(o.id) ?? 0,
      staff: staff.get(o.id) ?? 0,
      sessions30d: sessions30d.get(o.id) ?? 0,
      checkins30d: checkins30d.get(o.id) ?? 0,
      lastActivityAt: lastActivity.get(o.id) ?? null,
    }
  })

  return {
    tenants,
    queues: {
      pendingRefunds: refunds.count ?? 0,
      pendingDeletions: deletions.count ?? 0,
      unreadFeedback: feedback.count ?? 0,
    },
  }
})

/**
 * Histórico de assinatura para a série de movimento de MRR. Tolerante: se a
 * migration 20260807000000 ainda não rodou, devolve lista vazia e o painel
 * mostra o estado "ainda não há histórico" em vez de quebrar.
 */
export const getSubscriptionEvents = cache(async function getSubscriptionEvents(): Promise<
  SubscriptionEvent[]
> {
  const admin = createAdminClient()

  // Sem recorte de data: eventos anteriores à janela do gráfico são o que
  // estabelece o MRR de PARTIDA de cada conta. Cortar por data faria uma
  // academia que assinou há um ano aparecer com MRR zero no início da série.
  // O volume é uma linha por mudança de assinatura — cresce devagar.
  // Tolerante de propósito: se a migration 20260807000000 ainda não rodou, a
  // tabela não existe e o painel mostra "histórico ainda não iniciado" em vez
  // de quebrar. As demais leituras deixam estourar — ali um erro silencioso
  // viraria número errado com cara de certo.
  let rows: EventRow[] = []
  try {
    rows = await fetchAllPages<EventRow>(
      (from, to) =>
        admin
          .from('platform_subscription_events')
          .select('organization_id, to_status, mrr_cents, source, occurred_at')
          .order('id')
          .range(from, to),
      { label: 'super-admin/platform_subscription_events' },
    )
  } catch (e) {
    console.error('[super-admin] histórico de assinatura indisponível', e)
    return []
  }

  return rows.map((r) => ({
    organizationId: r.organization_id,
    toStatus: r.to_status,
    mrrCents: r.mrr_cents,
    source: r.source,
    occurredAt: r.occurred_at,
  }))
})

/** Uma academia do retrato — para a página de detalhe reusar a mesma métrica. */
export async function getTenantSnapshot(orgId: string): Promise<TenantSnapshot | null> {
  const { tenants } = await getPlatformSnapshot()
  return tenants.find((t) => t.id === orgId) ?? null
}

// ---------------------------------------------------------------------------
// Séries e listas auxiliares do detalhe da academia
// ---------------------------------------------------------------------------

export interface TenantUsagePoint {
  label: string
  sessions: number
  checkins: number
}

/**
 * Uso semana a semana da academia nas últimas `weeks` semanas — mostra se a
 * conta está esquentando ou esfriando, que é o que antecipa churn.
 */
export async function getTenantUsageSeries(
  orgId: string,
  weeks = 8,
): Promise<TenantUsagePoint[]> {
  const admin = createAdminClient()
  const now = Date.now()
  const windowStart = new Date(now - weeks * 7 * 86_400_000)
  const startIso = windowStart.toISOString()

  const [sessions, checkins] = await Promise.all([
    fetchAllPages<SessionRow>(
      (from, to) =>
        admin
          .from('class_sessions')
          .select('organization_id, session_date')
          .eq('organization_id', orgId)
          .gte('session_date', startIso.slice(0, 10))
          .neq('status', 'cancelled')
          .order('id')
          .range(from, to),
      { label: 'super-admin/uso-semanal/class_sessions' },
    ),
    fetchAllPages<AttendanceRow>(
      (from, to) =>
        admin
          .from('attendance')
          .select('organization_id, checked_in_at')
          .eq('organization_id', orgId)
          .gte('checked_in_at', startIso)
          .order('id')
          .range(from, to),
      { label: 'super-admin/uso-semanal/attendance' },
    ),
  ])

  const buckets: TenantUsagePoint[] = []
  const edges: number[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = now - (i + 1) * 7 * 86_400_000
    edges.push(start)
    const d = new Date(start)
    buckets.push({
      label: `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      sessions: 0,
      checkins: 0,
    })
  }

  const bucketOf = (ms: number): number => {
    for (let i = edges.length - 1; i >= 0; i--) if (ms >= edges[i]) return i
    return -1
  }

  for (const s of sessions) {
    if (!s.session_date) continue
    const i = bucketOf(new Date(`${s.session_date}T12:00:00.000Z`).getTime())
    if (i >= 0) buckets[i].sessions++
  }
  for (const c of checkins) {
    if (!c.checked_in_at) continue
    const i = bucketOf(new Date(c.checked_in_at).getTime())
    if (i >= 0) buckets[i].checkins++
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Tipos das linhas cruas (locais — não vazam para a UI)
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string
  name: string
  slug: string
  city: string | null
  state: string | null
  owner_id: string | null
  status: 'active' | 'suspended'
  created_at: string
  onboarding_completed: boolean | null
  is_default: boolean | null
}

interface SubRow {
  organization_id: string
  status: string
  trial_ends_at: string | null
  current_period_end: string | null
  updated_at: string | null
  /** Ausente no fallback de quando a coluna ainda não existe no banco. */
  is_comped?: boolean | null
}

interface MembershipRow {
  organization_id: string | null
  role: string
  contract_active: boolean
}

interface SessionRow {
  organization_id: string | null
  session_date: string | null
}

interface AttendanceRow {
  organization_id: string | null
  checked_in_at: string | null
}

interface EventRow {
  organization_id: string
  to_status: string
  mrr_cents: number
  source: string
  occurred_at: string
}
