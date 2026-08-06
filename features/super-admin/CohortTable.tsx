// features/super-admin/CohortTable.tsx
import { formatPercent, type CohortRow } from '@/lib/superAdmin/metrics'
import { cn } from '@/lib/utils/cn'

/**
 * Retenção por coorte de entrada: de cada mês de cadastro, quantas academias
 * seguem na base hoje. É um retrato do presente por safra — não uma curva
 * mês-a-mês, que exigiria histórico de assinatura que o schema não guarda.
 */
export function CohortTable({ rows }: { rows: CohortRow[] }) {
  const withData = rows.filter((r) => r.size > 0)
  if (withData.length === 0) {
    return <p className="text-xs text-slate-500">Nenhuma academia cadastrada no período.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500">
            <th scope="col" className="pb-2 font-bold">Safra</th>
            <th scope="col" className="pb-2 text-right font-bold">Entraram</th>
            <th scope="col" className="pb-2 text-right font-bold">Na base</th>
            <th scope="col" className="pb-2 pl-3 font-bold">Retenção</th>
          </tr>
        </thead>
        <tbody>
          {withData.map((r) => (
            <tr key={r.month} className="border-t border-white/[0.06]">
              <th scope="row" className="py-2 font-semibold text-slate-300">{r.label}</th>
              <td className="py-2 text-right tabular-nums text-slate-400">{r.size}</td>
              <td className="py-2 text-right tabular-nums font-bold text-white">{r.retained}</td>
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-full max-w-[90px] overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        r.rate >= 0.7 ? 'bg-emerald-400' : r.rate >= 0.4 ? 'bg-amber-400' : 'bg-red-400',
                      )}
                      style={{ width: `${Math.max(r.rate * 100, r.rate > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <span className="w-11 shrink-0 text-right tabular-nums text-slate-300">
                    {formatPercent(r.rate, 0)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
