'use client'
// app/(super-admin)/super-admin/OrgList.tsx
import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { filterOrganizations, type OrgListRow } from '@/lib/superAdmin/filterOrgs'

// Cor do badge por status da assinatura SaaS.
function subVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'past_due') return 'warning'
  if (status === 'canceled') return 'danger'
  return 'default' // trialing / none
}

export function OrgList({ rows }: { rows: OrgListRow[] }) {
  const [q, setQ] = useState('')
  const filtered = filterOrganizations(rows, q)
  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome…"
        aria-label="Buscar academia por nome"
        className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <div className="overflow-hidden rounded-xl border border-surface-border">
        {filtered.map((r) => (
          <Link
            key={r.id}
            href={`/super-admin/${r.id}`}
            className="flex items-center gap-3 border-b border-surface-border px-3 py-3 last:border-b-0 hover:bg-surface-card"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{r.name}</p>
              <p className="truncate text-xs text-slate-500">
                {[r.city, r.state].filter(Boolean).join('/') || 'Sem localização'} ·{' '}
                {r.owner_name ?? 'Sem dono'}
              </p>
            </div>
            {r.org_status === 'suspended' && <Badge variant="danger">Suspensa</Badge>}
            <Badge variant={subVariant(r.sub_status)}>{r.sub_status}</Badge>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            Nenhuma academia encontrada.
          </p>
        )}
      </div>
    </div>
  )
}
