// features/liga/PointsLedger.tsx
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'
import { POINT_REASON_LABEL } from '@/lib/liga/labels'
import type { LigaPointEntry } from '@/types'

interface Props {
  entries: LigaPointEntry[]
}

/**
 * Extrato do aluno. Existe para que "por que ele tem mais ponto que eu?" tenha
 * resposta — sem extrato, gamificação vira caixa-preta e gera discussão na quadra.
 */
export function PointsLedger({ entries }: Props) {
  if (entries.length === 0) return null

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">DE ONDE VIERAM MEUS PONTOS</p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-sm">
            <span className="text-brand-500 font-medium shrink-0 w-12">
              {e.points > 0 ? `+${e.points}` : e.points}
            </span>
            <span className="flex-1 min-w-0">
              <span className="text-slate-200">{POINT_REASON_LABEL[e.reason] ?? e.reason}</span>
              {e.note && <span className="text-slate-400"> — {e.note}</span>}
            </span>
            <span className="text-xs text-slate-500 shrink-0">{formatDate(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
