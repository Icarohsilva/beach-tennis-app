'use client'
// features/super-admin/TenantTable.tsx
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import {
  availableStates,
  filterTenants,
  formatBRL,
  relativeDays,
  sortTenants,
  tenantHealth,
  tenantMrr,
  tenantsToCsv,
  SUB_STATUS_LABEL,
  type HealthTier,
  type SubStatus,
  type TenantSnapshot,
  type TenantSortKey,
} from '@/lib/superAdmin/metrics'
import { HealthPill } from './HealthPill'
import { StatusBadge } from './StatusBadge'

const COLUMNS: { key: TenantSortKey; label: string; numeric?: boolean; hideOnSm?: boolean }[] = [
  { key: 'name', label: 'Academia' },
  { key: 'subStatus', label: 'Assinatura' },
  { key: 'students', label: 'Alunos', numeric: true },
  { key: 'sessions30d', label: 'Aulas 30d', numeric: true, hideOnSm: true },
  { key: 'checkins30d', label: 'Presenças 30d', numeric: true, hideOnSm: true },
  { key: 'health', label: 'Saúde' },
  { key: 'lastActivityAt', label: 'Atividade', hideOnSm: true },
]

const STATUS_OPTIONS: { value: SubStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todas as assinaturas' },
  { value: 'active', label: SUB_STATUS_LABEL.active },
  { value: 'trialing', label: SUB_STATUS_LABEL.trialing },
  { value: 'past_due', label: SUB_STATUS_LABEL.past_due },
  { value: 'canceled', label: SUB_STATUS_LABEL.canceled },
  { value: 'none', label: SUB_STATUS_LABEL.none },
]

const HEALTH_OPTIONS: { value: HealthTier | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Toda a saúde' },
  { value: 'saudavel', label: 'Saudável' },
  { value: 'atencao', label: 'Atenção' },
  { value: 'risco', label: 'Risco' },
]

const selectClass =
  'rounded-lg border border-surface-border bg-surface-card px-2.5 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'

/**
 * Tabela operacional das academias: busca, filtros por assinatura/saúde/UF,
 * ordenação por qualquer coluna e exportação CSV do recorte visível.
 *
 * `nowIso` vem do servidor (e não de new Date() no cliente) para que health e
 * "última atividade" batam com o que o resto da página renderizou.
 */
export function TenantTable({
  tenants,
  price,
  nowIso,
  initialStatus = 'todos',
  initialHealth = 'todos',
}: {
  tenants: TenantSnapshot[]
  price: number
  nowIso: string
  initialStatus?: SubStatus | 'todos'
  initialHealth?: HealthTier | 'todos'
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<SubStatus | 'todos'>(initialStatus)
  const [health, setHealth] = useState<HealthTier | 'todos'>(initialHealth)
  const [uf, setUf] = useState<string>('todos')
  const [onlySuspended, setOnlySuspended] = useState(false)
  const [sortKey, setSortKey] = useState<TenantSortKey>('health')
  const [asc, setAsc] = useState(true)

  const ufs = useMemo(() => availableStates(tenants), [tenants])

  const rows = useMemo(
    () =>
      sortTenants(
        filterTenants(tenants, { q, status, health, uf, onlySuspended }, now),
        sortKey,
        asc,
        now,
      ),
    [tenants, q, status, health, uf, onlySuspended, sortKey, asc, now],
  )

  const filtering =
    q !== '' || status !== 'todos' || health !== 'todos' || uf !== 'todos' || onlySuspended

  function toggleSort(key: TenantSortKey) {
    if (key === sortKey) {
      setAsc((v) => !v)
      return
    }
    setSortKey(key)
    // Texto começa em A→Z; número/data começam do maior, que é o que se procura.
    setAsc(key === 'name' || key === 'subStatus')
  }

  function clearFilters() {
    setQ('')
    setStatus('todos')
    setHealth('todos')
    setUf('todos')
    setOnlySuspended(false)
  }

  function exportCsv() {
    const csv = tenantsToCsv(rows, price, now)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `academias-${nowIso.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totalMrr = rows.reduce((sum, r) => sum + tenantMrr(r, price), 0)

  return (
    <div className="space-y-3">
      {/* Filtros: uma faixa acima da tabela. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por academia, cidade, dono ou e-mail…"
            aria-label="Buscar academia"
            className="w-full rounded-lg border border-surface-border bg-surface-card py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SubStatus | 'todos')}
          aria-label="Filtrar por status da assinatura"
          className={selectClass}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={health}
          onChange={(e) => setHealth(e.target.value as HealthTier | 'todos')}
          aria-label="Filtrar por saúde da conta"
          className={selectClass}
        >
          {HEALTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {ufs.length > 1 && (
          <select
            value={uf}
            onChange={(e) => setUf(e.target.value)}
            aria-label="Filtrar por estado"
            className={selectClass}
          >
            <option value="todos">Todo o Brasil</option>
            {ufs.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-surface-border bg-surface-card px-2.5 py-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlySuspended}
            onChange={(e) => setOnlySuspended(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Só suspensas
        </label>

        {filtering && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}

        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-surface-border disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>

      <p className="text-xs text-slate-500" aria-live="polite">
        {rows.length} de {tenants.length}{' '}
        {tenants.length === 1 ? 'academia' : 'academias'} · MRR do recorte{' '}
        <strong className="text-slate-300">{formatBRL(totalMrr)}</strong>
      </p>

      {/* Tabela larga rola no próprio contêiner — a página nunca rola na horizontal. */}
      <div className="overflow-x-auto rounded-xl border border-surface-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/[0.02]">
            <tr>
              {COLUMNS.map((c) => {
                const active = sortKey === c.key
                const Icon = active ? (asc ? ArrowUp : ArrowDown) : ChevronsUpDown
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      'px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500',
                      c.numeric && 'text-right',
                      c.hideOnSm && 'hidden lg:table-cell',
                    )}
                  >
                    <button
                      onClick={() => toggleSort(c.key)}
                      aria-label={`Ordenar por ${c.label}`}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-white',
                        active && 'text-white',
                        c.numeric && 'flex-row-reverse',
                      )}
                    >
                      {c.label}
                      <Icon className="h-3 w-3" />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const h = tenantHealth(t, now)
              return (
                <tr key={t.id} className="border-t border-surface-border transition-colors hover:bg-surface-card">
                  <td className="px-3 py-2.5">
                    <Link href={`/super-admin/${t.id}`} className="group block">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold text-white group-hover:text-brand-400">
                          {t.name}
                        </span>
                        {t.orgStatus === 'suspended' && (
                          <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            SUSPENSA
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {[t.city, t.state].filter(Boolean).join('/') || 'Sem localização'}
                        {t.ownerName ? ` · ${t.ownerName}` : ''}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={t.subStatus} comped={t.isComped} />
                    <span className="mt-0.5 block text-xs tabular-nums text-slate-500">
                      {formatBRL(tenantMrr(t, price))}/mês
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="font-semibold text-white">{t.activeStudents}</span>
                    <span className="block text-xs text-slate-500">de {t.students}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-slate-300 lg:table-cell">
                    {t.sessions30d}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-slate-300 lg:table-cell">
                    {t.checkins30d}
                  </td>
                  <td className="px-3 py-2.5">
                    <HealthPill tier={h.tier} score={h.score} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-xs text-slate-400 lg:table-cell">
                    {relativeDays(t.lastActivityAt, now)}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-sm text-slate-500">
                  Nenhuma academia bate com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
