// lib/superAdmin/metrics.ts
// Métricas de NEGÓCIO da plataforma (SaaS), puras — sem I/O, sem imports de
// servidor — para serem testáveis e reusáveis entre páginas.
//
// Honestidade das métricas: o schema não guarda histórico de MRR (não existe
// tabela de eventos de assinatura). Então tudo aqui é derivado do ESTADO ATUAL
// de `platform_subscriptions` + `organizations.created_at`. Onde a derivação é
// uma aproximação, o nome da função diz isso e o comentário explica o limite —
// nenhuma métrica é inventada além do que o dado sustenta.

export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none'

/** Retrato de uma academia (tenant) para o painel de plataforma. Serializável. */
export interface TenantSnapshot {
  id: string
  name: string
  slug: string
  city: string | null
  state: string | null
  ownerName: string | null
  ownerEmail: string | null
  /** Suspensão operacional manual (eixo independente da cobrança). */
  orgStatus: 'active' | 'suspended'
  subStatus: SubStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  /** Aproximação da data de cancelamento: `platform_subscriptions.updated_at`. */
  subUpdatedAt: string | null
  createdAt: string
  onboardingCompleted: boolean
  /** Conta cortesia/vitalícia (`organizations.is_default`) — não entra no MRR. */
  isComped: boolean
  students: number
  activeStudents: number
  staff: number
  sessions30d: number
  checkins30d: number
  /** Último sinal de vida (aula gerada ou presença registrada). */
  lastActivityAt: string | null
}

const DAY_MS = 86_400_000

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

/** Dias até `iso`; negativo se já passou; null se não houver data. */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS)
}

// ---------------------------------------------------------------------------
// Receita
// ---------------------------------------------------------------------------

/**
 * MRR de UMA academia. Só assinatura `active` gera receita recorrente; trial,
 * past_due (cobrança falhou — o dinheiro não entrou) e canceled valem 0.
 * Conta cortesia (vitalícia) fica de fora: aparece como ativa, mas não paga.
 */
export function tenantMrr(t: TenantSnapshot, price: number): number {
  if (t.isComped) return 0
  return t.subStatus === 'active' ? price : 0
}

/** Receita em risco: past_due é MRR que existia e a cobrança falhou. */
export function tenantMrrAtRisk(t: TenantSnapshot, price: number): number {
  if (t.isComped) return 0
  return t.subStatus === 'past_due' ? price : 0
}

export interface PlatformSummary {
  /** Receita recorrente mensal — só assinaturas ativas pagantes. */
  mrr: number
  /** MRR × 12. */
  arr: number
  /** Receita média por conta pagante. 0 se não houver pagante. */
  arpa: number
  /** MRR de assinaturas com cobrança falhada (past_due) — recuperável via dunning. */
  mrrAtRisk: number
  totalTenants: number
  payingTenants: number
  trialingTenants: number
  pastDueTenants: number
  canceledTenants: number
  compedTenants: number
  /** Sem linha em platform_subscriptions — anomalia de dados, bloqueia o painel da academia. */
  noSubTenants: number
  suspendedTenants: number
  /** Academias criadas nos últimos 30 dias. */
  newTenants30d: number
  /** Cancelamentos nos últimos 30 dias (por `subUpdatedAt` das linhas canceladas). */
  churnedTenants30d: number
  /** Churn de logo em 30d: cancelados / base no início da janela. 0..1. */
  logoChurnRate30d: number
  /** Retenção líquida de logo em 30d (1 - churn). 0..1. */
  logoRetentionRate30d: number
  /** Conversão de trial: dos trials já encerrados, quantos viraram pagantes. 0..1. */
  trialConversionRate: number
  /** Tamanho da coorte que sustenta a conversão acima (trials já encerrados). */
  trialConversionBase: number
  /** LTV = ARPA / churn mensal. null quando o churn é 0 (LTV indefinido). */
  ltv: number | null
  /** Academias com trial acabando nos próximos 7 dias. */
  trialsEndingIn7d: number
  /** Academias sem nenhuma aula nem presença nos últimos 30 dias. */
  inactiveTenants: number
  /** Total de alunos ativos somando todas as academias. */
  totalActiveStudents: number
  /** Aulas realizadas na plataforma nos últimos 30 dias. */
  totalSessions30d: number
  /** Check-ins na plataforma nos últimos 30 dias. */
  totalCheckins30d: number
}

/**
 * Consolida o retrato do negócio. `price` é o preço do plano único da
 * plataforma (lib/billing/platformPlan.ts).
 */
export function platformSummary(
  tenants: TenantSnapshot[],
  price: number,
  now: Date,
): PlatformSummary {
  const windowStart = new Date(now.getTime() - 30 * DAY_MS)

  let mrr = 0
  let mrrAtRisk = 0
  let payingTenants = 0
  let trialingTenants = 0
  let pastDueTenants = 0
  let canceledTenants = 0
  let compedTenants = 0
  let noSubTenants = 0
  let suspendedTenants = 0
  let newTenants30d = 0
  let churnedTenants30d = 0
  let trialsEndingIn7d = 0
  let inactiveTenants = 0
  let totalActiveStudents = 0
  let totalSessions30d = 0
  let totalCheckins30d = 0

  for (const t of tenants) {
    const revenue = tenantMrr(t, price)
    mrr += revenue
    if (revenue > 0) payingTenants++
    mrrAtRisk += tenantMrrAtRisk(t, price)

    if (t.isComped) compedTenants++
    if (t.subStatus === 'trialing') trialingTenants++
    if (t.subStatus === 'past_due') pastDueTenants++
    if (t.subStatus === 'canceled') canceledTenants++
    if (t.subStatus === 'none') noSubTenants++
    if (t.orgStatus === 'suspended') suspendedTenants++

    if (new Date(t.createdAt) >= windowStart) newTenants30d++
    if (
      t.subStatus === 'canceled' &&
      t.subUpdatedAt &&
      new Date(t.subUpdatedAt) >= windowStart
    ) {
      churnedTenants30d++
    }

    if (t.subStatus === 'trialing') {
      const left = daysUntil(t.trialEndsAt, now)
      if (left !== null && left >= 0 && left <= 7) trialsEndingIn7d++
    }

    if (t.sessions30d === 0 && t.checkins30d === 0) inactiveTenants++
    totalActiveStudents += t.activeStudents
    totalSessions30d += t.sessions30d
    totalCheckins30d += t.checkins30d
  }

  // Base do churn = quem estava na base no INÍCIO da janela (os que continuam
  // + os que saíram nela). Academias criadas dentro da janela não entram no
  // denominador, senão o crescimento mascara o churn.
  const retained = tenants.filter(
    (t) =>
      new Date(t.createdAt) < windowStart &&
      (t.subStatus === 'active' || t.subStatus === 'past_due' || t.subStatus === 'trialing'),
  ).length
  const churnBase = retained + churnedTenants30d
  const logoChurnRate30d = churnBase > 0 ? churnedTenants30d / churnBase : 0

  // Conversão de trial: só entram academias cujo trial JÁ acabou (senão o
  // denominador conta gente que ainda pode converter e a taxa fica pessimista).
  const settled = tenants.filter((t) => {
    if (t.isComped) return false
    if (t.subStatus === 'active' || t.subStatus === 'past_due') return true
    const left = daysUntil(t.trialEndsAt, now)
    return left !== null && left < 0
  })
  const converted = settled.filter(
    (t) => t.subStatus === 'active' || t.subStatus === 'past_due',
  ).length
  const trialConversionRate = settled.length > 0 ? converted / settled.length : 0

  const arpa = payingTenants > 0 ? mrr / payingTenants : 0
  const ltv = logoChurnRate30d > 0 ? arpa / logoChurnRate30d : null

  return {
    mrr,
    arr: mrr * 12,
    arpa,
    mrrAtRisk,
    totalTenants: tenants.length,
    payingTenants,
    trialingTenants,
    pastDueTenants,
    canceledTenants,
    compedTenants,
    noSubTenants,
    suspendedTenants,
    newTenants30d,
    churnedTenants30d,
    logoChurnRate30d,
    logoRetentionRate30d: 1 - logoChurnRate30d,
    trialConversionRate,
    trialConversionBase: settled.length,
    ltv,
    trialsEndingIn7d,
    inactiveTenants,
    totalActiveStudents,
    totalSessions30d,
    totalCheckins30d,
  }
}

// ---------------------------------------------------------------------------
// Saúde da conta (health score)
// ---------------------------------------------------------------------------

export type HealthTier = 'saudavel' | 'atencao' | 'risco'

export interface TenantHealth {
  score: number // 0..100
  tier: HealthTier
  /** Motivos legíveis das penalidades — o painel mostra ao invés de só o número. */
  reasons: string[]
}

/**
 * Health score de retenção: combina estado de cobrança, ativação (onboarding e
 * alunos) e uso real (aulas e presenças nos últimos 30 dias). Serve para o time
 * priorizar quem ligar antes de a conta cancelar.
 */
export function tenantHealth(t: TenantSnapshot, now: Date): TenantHealth {
  let score = 100
  const reasons: string[] = []

  const penalize = (points: number, reason: string) => {
    score -= points
    reasons.push(reason)
  }

  if (t.orgStatus === 'suspended') penalize(40, 'Academia suspensa')
  if (t.subStatus === 'canceled') penalize(50, 'Assinatura cancelada')
  else if (t.subStatus === 'past_due') penalize(30, 'Pagamento em atraso')
  else if (t.subStatus === 'none') penalize(30, 'Sem assinatura registrada')

  if (!t.onboardingCompleted) penalize(30, 'Onboarding não concluído')

  if (t.activeStudents === 0) penalize(25, 'Nenhum aluno ativo')
  else if (t.activeStudents < 5) penalize(10, 'Menos de 5 alunos ativos')

  if (t.sessions30d === 0) penalize(25, 'Nenhuma aula em 30 dias')
  else if (t.sessions30d < 4) penalize(10, 'Menos de 4 aulas em 30 dias')

  if (t.checkins30d === 0) penalize(15, 'Nenhuma presença em 30 dias')

  if (t.subStatus === 'trialing') {
    const left = daysUntil(t.trialEndsAt, now)
    if (left !== null && left >= 0 && left <= 3 && t.sessions30d === 0) {
      penalize(15, 'Trial acabando sem uso')
    }
  }

  score = Math.max(0, Math.min(100, score))
  const tier: HealthTier = score >= 70 ? 'saudavel' : score >= 40 ? 'atencao' : 'risco'
  return { score, tier, reasons }
}

export const HEALTH_LABEL: Record<HealthTier, string> = {
  saudavel: 'Saudável',
  atencao: 'Atenção',
  risco: 'Risco',
}

// ---------------------------------------------------------------------------
// Fila de atenção — o que exige ação humana hoje
// ---------------------------------------------------------------------------

export type AttentionSeverity = 'alta' | 'media' | 'baixa'

export interface AttentionItem {
  id: string
  severity: AttentionSeverity
  title: string
  detail: string
  href: string
}

/** Contadores das filas operacionais que não vêm de `tenants`. */
export interface QueueCounts {
  pendingRefunds: number
  pendingDeletions: number
  unreadFeedback: number
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { alta: 0, media: 1, baixa: 2 }

/**
 * Monta a lista priorizada de pendências: dinheiro parado primeiro, depois
 * risco de churn, depois filas de suporte/jurídico.
 */
export function attentionQueue(
  tenants: TenantSnapshot[],
  queues: QueueCounts,
  now: Date,
): AttentionItem[] {
  const items: AttentionItem[] = []

  const pastDue = tenants.filter((t) => t.subStatus === 'past_due')
  if (pastDue.length > 0) {
    items.push({
      id: 'past-due',
      severity: 'alta',
      title: `${pastDue.length} ${pastDue.length === 1 ? 'academia com pagamento em atraso' : 'academias com pagamento em atraso'}`,
      detail: pastDue.map((t) => t.name).slice(0, 3).join(', '),
      href: '/super-admin/academias?status=past_due',
    })
  }

  if (queues.pendingRefunds > 0) {
    items.push({
      id: 'refunds',
      severity: 'alta',
      title: `${queues.pendingRefunds} ${queues.pendingRefunds === 1 ? 'reembolso pendente' : 'reembolsos pendentes'}`,
      detail: 'Prazo de arrependimento do CDC corre a partir da solicitação.',
      href: '/super-admin/reembolsos',
    })
  }

  if (queues.pendingDeletions > 0) {
    items.push({
      id: 'deletions',
      severity: 'alta',
      title: `${queues.pendingDeletions} ${queues.pendingDeletions === 1 ? 'exclusão de conta pendente' : 'exclusões de conta pendentes'}`,
      detail: 'Solicitações da LGPD aguardando execução.',
      href: '/super-admin/exclusoes',
    })
  }

  const endingTrials = tenants.filter((t) => {
    if (t.subStatus !== 'trialing') return false
    const left = daysUntil(t.trialEndsAt, now)
    return left !== null && left >= 0 && left <= 7
  })
  if (endingTrials.length > 0) {
    items.push({
      id: 'trials-ending',
      severity: 'media',
      title: `${endingTrials.length} ${endingTrials.length === 1 ? 'trial acabando' : 'trials acabando'} em 7 dias`,
      detail: endingTrials.map((t) => t.name).slice(0, 3).join(', '),
      href: '/super-admin/academias?status=trialing',
    })
  }

  const atRisk = tenants.filter(
    (t) => t.subStatus !== 'canceled' && tenantHealth(t, now).tier === 'risco',
  )
  if (atRisk.length > 0) {
    items.push({
      id: 'at-risk',
      severity: 'media',
      title: `${atRisk.length} ${atRisk.length === 1 ? 'academia em risco' : 'academias em risco'}`,
      detail: atRisk.map((t) => t.name).slice(0, 3).join(', '),
      href: '/super-admin/academias?health=risco',
    })
  }

  const stalled = tenants.filter((t) => !t.onboardingCompleted && t.subStatus !== 'canceled')
  if (stalled.length > 0) {
    items.push({
      id: 'onboarding',
      severity: 'media',
      title: `${stalled.length} ${stalled.length === 1 ? 'academia sem concluir o onboarding' : 'academias sem concluir o onboarding'}`,
      detail: stalled.map((t) => t.name).slice(0, 3).join(', '),
      href: '/super-admin/academias?health=risco',
    })
  }

  const orphan = tenants.filter((t) => t.subStatus === 'none')
  if (orphan.length > 0) {
    items.push({
      id: 'no-subscription',
      severity: 'alta',
      title: `${orphan.length} ${orphan.length === 1 ? 'academia sem assinatura registrada' : 'academias sem assinatura registrada'}`,
      detail: 'Sem linha em platform_subscriptions o painel da academia fica bloqueado.',
      href: '/super-admin/academias?status=none',
    })
  }

  if (queues.unreadFeedback > 0) {
    items.push({
      id: 'feedback',
      severity: 'baixa',
      title: `${queues.unreadFeedback} ${queues.unreadFeedback === 1 ? 'feedback novo' : 'feedbacks novos'}`,
      detail: 'Relatos de bug, elogio e ideia enviados pelo app.',
      href: '/super-admin/feedback',
    })
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// ---------------------------------------------------------------------------
// Séries temporais
// ---------------------------------------------------------------------------

export interface GrowthPoint {
  /** Chave AAAA-MM do mês. */
  month: string
  /** Rótulo curto (mm/aa) para o eixo. */
  label: string
  /** Academias criadas no mês. */
  novas: number
  /** Total acumulado de academias até o fim do mês. */
  acumulado: number
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Aquisição por mês (últimos `months` meses, incluindo o atual). Vem de
 * `organizations.created_at` — dado exato, sem aproximação.
 */
export function growthSeries(
  tenants: TenantSnapshot[],
  months: number,
  now: Date,
): GrowthPoint[] {
  const buckets: GrowthPoint[] = []
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = monthKey(d)
    keys.push(key)
    buckets.push({
      month: key,
      label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`,
      novas: 0,
      acumulado: 0,
    })
  }

  const firstKey = keys[0]
  let carriedOver = 0
  const perMonth = new Map<string, number>()
  for (const t of tenants) {
    const key = monthKey(new Date(t.createdAt))
    if (key < firstKey) carriedOver++
    else perMonth.set(key, (perMonth.get(key) ?? 0) + 1)
  }

  let running = carriedOver
  for (const b of buckets) {
    b.novas = perMonth.get(b.month) ?? 0
    running += b.novas
    b.acumulado = running
  }
  return buckets
}

export interface CohortRow {
  month: string
  label: string
  /** Academias que entraram nesse mês. */
  size: number
  /** Quantas continuam pagantes ou em trial hoje. */
  retained: number
  /** retained / size, 0..1. */
  rate: number
}

/**
 * Retenção por coorte de entrada. É um retrato de HOJE por mês de cadastro
 * (não uma curva mês-a-mês, que exigiria histórico de assinatura).
 */
export function cohortRetention(
  tenants: TenantSnapshot[],
  months: number,
  now: Date,
): CohortRow[] {
  const rows: CohortRow[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = monthKey(d)
    const cohort = tenants.filter((t) => monthKey(new Date(t.createdAt)) === key)
    const retained = cohort.filter(
      (t) => t.subStatus === 'active' || t.subStatus === 'past_due' || t.subStatus === 'trialing',
    ).length
    rows.push({
      month: key,
      label: `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`,
      size: cohort.length,
      retained,
      rate: cohort.length > 0 ? retained / cohort.length : 0,
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Tabela de academias — busca, filtro, ordenação, exportação
// ---------------------------------------------------------------------------

export type TenantSortKey =
  | 'name'
  | 'createdAt'
  | 'subStatus'
  | 'students'
  | 'sessions30d'
  | 'checkins30d'
  | 'health'
  | 'lastActivityAt'

export interface TenantFilters {
  q?: string
  status?: SubStatus | 'todos'
  health?: HealthTier | 'todos'
  uf?: string | 'todos'
  /** Só academias suspensas operacionalmente. */
  onlySuspended?: boolean
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Busca tolerante a acento/caixa em nome, cidade, dono e e-mail do dono. */
export function filterTenants(
  rows: TenantSnapshot[],
  filters: TenantFilters,
  now: Date,
): TenantSnapshot[] {
  const q = normalize(filters.q ?? '')
  return rows.filter((r) => {
    if (q) {
      const haystack = normalize(
        [r.name, r.city, r.state, r.ownerName, r.ownerEmail].filter(Boolean).join(' '),
      )
      if (!haystack.includes(q)) return false
    }
    if (filters.status && filters.status !== 'todos' && r.subStatus !== filters.status) return false
    if (filters.uf && filters.uf !== 'todos' && (r.state ?? '') !== filters.uf) return false
    if (filters.onlySuspended && r.orgStatus !== 'suspended') return false
    if (filters.health && filters.health !== 'todos') {
      if (tenantHealth(r, now).tier !== filters.health) return false
    }
    return true
  })
}

const STATUS_RANK: Record<SubStatus, number> = {
  past_due: 0,
  none: 1,
  trialing: 2,
  active: 3,
  canceled: 4,
}

/** Ordena sem mutar a entrada. `asc = false` é o padrão útil dos numéricos. */
export function sortTenants(
  rows: TenantSnapshot[],
  key: TenantSortKey,
  asc: boolean,
  now: Date,
): TenantSnapshot[] {
  const dir = asc ? 1 : -1
  const value = (r: TenantSnapshot): number | string => {
    switch (key) {
      case 'name':
        return normalize(r.name)
      case 'createdAt':
        return new Date(r.createdAt).getTime()
      case 'subStatus':
        return STATUS_RANK[r.subStatus]
      case 'students':
        return r.activeStudents
      case 'sessions30d':
        return r.sessions30d
      case 'checkins30d':
        return r.checkins30d
      case 'health':
        return tenantHealth(r, now).score
      case 'lastActivityAt':
        return r.lastActivityAt ? new Date(r.lastActivityAt).getTime() : 0
    }
  }
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir
    return ((va as number) - (vb as number)) * dir
  })
}

/** UFs presentes na base, ordenadas — alimenta o filtro por estado. */
export function availableStates(rows: TenantSnapshot[]): string[] {
  const set = new Set<string>()
  for (const r of rows) if (r.state) set.add(r.state)
  return Array.from(set).sort()
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * CSV das academias para levar pra planilha. Separador `;` e BOM porque o
 * público é brasileiro e o Excel pt-BR só abre direito assim.
 */
export function tenantsToCsv(rows: TenantSnapshot[], price: number, now: Date): string {
  const header = [
    'Academia',
    'Cidade',
    'UF',
    'Dono',
    'E-mail',
    'Status assinatura',
    'MRR',
    'Alunos ativos',
    'Alunos totais',
    'Equipe',
    'Aulas 30d',
    'Presencas 30d',
    'Health',
    'Tier',
    'Onboarding',
    'Suspensa',
    'Criada em',
    'Ultima atividade',
  ]
  const lines = rows.map((r) => {
    const h = tenantHealth(r, now)
    return [
      r.name,
      r.city,
      r.state,
      r.ownerName,
      r.ownerEmail,
      r.subStatus,
      tenantMrr(r, price).toFixed(2).replace('.', ','),
      r.activeStudents,
      r.students,
      r.staff,
      r.sessions30d,
      r.checkins30d,
      h.score,
      HEALTH_LABEL[h.tier],
      r.onboardingCompleted ? 'sim' : 'nao',
      r.orgStatus === 'suspended' ? 'sim' : 'nao',
      r.createdAt.slice(0, 10),
      r.lastActivityAt ? r.lastActivityAt.slice(0, 10) : '',
    ].map(csvCell).join(';')
  })
  return '﻿' + [header.join(';'), ...lines].join('\n')
}

// ---------------------------------------------------------------------------
// Formatação (pt-BR) — usada pelas páginas do painel
// ---------------------------------------------------------------------------

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  })
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`
}

/** "há 3 dias" / "hoje" / "—". Relativo, que é como o time lê atividade. */
export function relativeDays(iso: string | null, now: Date): string {
  if (!iso) return '—'
  const d = daysBetween(new Date(iso), now)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  if (d < 30) return `há ${d} dias`
  const months = Math.floor(d / 30)
  return months === 1 ? 'há 1 mês' : `há ${months} meses`
}

export const SUB_STATUS_LABEL: Record<SubStatus, string> = {
  active: 'Ativa',
  trialing: 'Trial',
  past_due: 'Em atraso',
  canceled: 'Cancelada',
  none: 'Sem assinatura',
}
