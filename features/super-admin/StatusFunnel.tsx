// features/super-admin/StatusFunnel.tsx
import Link from 'next/link'
import { SUB_STATUS_LABEL, formatPercent, type SubStatus } from '@/lib/superAdmin/metrics'
import { STATUS_FILL, STATUS_ORDER } from './chartPalette'

export interface FunnelSlice {
  status: SubStatus
  count: number
}

/**
 * Distribuição da base por estado de assinatura, em barra empilhada única.
 * Uma barra (e não pizza) porque o que se compara é proporção de UMA base.
 * Cada fatia tem 2px de respiro, e a legenda abaixo repete rótulo e número —
 * a cor sozinha nunca carrega a informação.
 */
export function StatusFunnel({ slices }: { slices: FunnelSlice[] }) {
  const byStatus = new Map(slices.map((s) => [s.status, s.count]))
  const ordered = STATUS_ORDER.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  })).filter((s) => s.count > 0)
  const total = ordered.reduce((sum, s) => sum + s.count, 0)

  if (total === 0) {
    return <p className="text-sm text-slate-500">Nenhuma academia cadastrada ainda.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {ordered.map((s) => (
          <div
            key={s.status}
            title={`${SUB_STATUS_LABEL[s.status]}: ${s.count} (${formatPercent(s.count / total, 0)})`}
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: STATUS_FILL[s.status] }}
          />
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {ordered.map((s) => (
          <li key={s.status}>
            <Link
              href={`/super-admin/academias?status=${s.status}`}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-xs transition-colors hover:bg-white/[0.04]"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_FILL[s.status] }}
              />
              <span className="truncate text-slate-300">{SUB_STATUS_LABEL[s.status]}</span>
              <span className="ml-auto font-bold text-white">{s.count}</span>
              <span className="w-10 text-right text-slate-500">
                {formatPercent(s.count / total, 0)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
