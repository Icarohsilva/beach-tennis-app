// features/super-admin/MrrMovementTable.tsx
import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatBRL } from '@/lib/superAdmin/metrics'
import { centsToBRL, type MrrMovementRow } from '@/lib/superAdmin/mrrMovement'

function Money({ cents, tone }: { cents: number; tone?: 'up' | 'down' }) {
  if (cents === 0) return <span className="text-slate-600">—</span>
  return (
    <span className={cn('tabular-nums', tone === 'up' ? 'text-emerald-300' : 'text-red-300')}>
      {cents > 0 ? '+' : '−'}
      {formatBRL(Math.abs(centsToBRL(cents)))}
    </span>
  )
}

/**
 * Movimento de MRR mês a mês. Tabela e não gráfico de propósito: são cinco
 * medidas com sinais opostos e valores pequenos: em barras empilhadas viraria
 * um borrão, e o que se lê aqui são os números exatos.
 *
 * `since` é a data do primeiro evento registrado — o painel diz desde quando
 * está medindo, em vez de deixar parecer que sempre mediu.
 */
export function MrrMovementTable({
  rows,
  since,
}: {
  rows: MrrMovementRow[]
  since: string | null
}) {
  if (since === null) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
        <p className="text-sm font-semibold text-slate-300">Histórico ainda não iniciado</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          O movimento de MRR é montado a partir das mudanças de assinatura registradas a partir
          de agora. Rode a migration de histórico e a série começa a se preencher na primeira
          conversão, cancelamento ou renovação.
        </p>
      </div>
    )
  }

  // Só mostra meses a partir do início da medição — antes disso não há dado,
  // e uma linha de zeros pareceria "nenhuma venda" em vez de "não medido".
  const sinceMonth = since.slice(0, 7)
  const visible = rows.filter((r) => r.month >= sinceMonth)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-right text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th scope="col" className="pb-2 text-left font-bold">Mês</th>
              <th scope="col" className="pb-2 font-bold">Novo</th>
              <th scope="col" className="pb-2 font-bold">Reativação</th>
              <th scope="col" className="pb-2 font-bold">Expansão</th>
              <th scope="col" className="pb-2 font-bold">Contração</th>
              <th scope="col" className="pb-2 font-bold">Churn</th>
              <th scope="col" className="pb-2 font-bold">Líquido</th>
              <th scope="col" className="pb-2 font-bold">MRR final</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.month} className="border-t border-white/[0.06]">
                <th scope="row" className="py-2 text-left font-semibold text-slate-300">
                  {r.label}
                </th>
                <td className="py-2"><Money cents={r.novoCents} tone="up" /></td>
                <td className="py-2"><Money cents={r.reativacaoCents} tone="up" /></td>
                <td className="py-2"><Money cents={r.expansaoCents} tone="up" /></td>
                <td className="py-2"><Money cents={r.contracaoCents} tone="down" /></td>
                <td className="py-2"><Money cents={r.churnCents} tone="down" /></td>
                <td className="py-2 font-bold">
                  {r.liquidoCents === 0 ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 tabular-nums',
                        r.liquidoCents > 0 ? 'text-emerald-300' : 'text-red-300',
                      )}
                    >
                      {r.liquidoCents > 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : (
                        <TrendingDown className="h-3 w-3" />
                      )}
                      {formatBRL(Math.abs(centsToBRL(r.liquidoCents)))}
                    </span>
                  )}
                </td>
                <td className="py-2 font-bold tabular-nums text-white">
                  {formatBRL(centsToBRL(r.mrrFinalCents))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-500">
        Medindo desde {new Date(since).toLocaleDateString('pt-BR')}. Com plano único, expansão e
        contração ficam sempre em zero — as colunas existem para o dia em que houver mais de um
        plano.
      </p>
    </div>
  )
}
