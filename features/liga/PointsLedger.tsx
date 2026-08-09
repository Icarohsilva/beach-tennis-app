// features/liga/PointsLedger.tsx
import { CalendarCheck, Flame, Trophy, Medal, Sparkles, Heart } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatDate } from '@/lib/utils/dateHelpers'
import { POINT_REASON_LABEL } from '@/lib/liga/labels'
import { cn } from '@/lib/utils/cn'
import type { LigaPointEntry } from '@/types'

interface Props {
  entries: LigaPointEntry[]
}

const REASON_ICON: Record<string, LucideIcon> = {
  attendance: CalendarCheck,
  streak: Flame,
  tournament_entry: Trophy,
  tournament_result: Medal,
  manual: Sparkles,
  kudos_given: Heart,
  kudos_received: Heart,
}

/**
 * Extrato do aluno. Existe para que "por que ele tem mais ponto que eu?" tenha
 * resposta — sem extrato, gamificação vira caixa-preta e gera discussão na quadra.
 */
export function PointsLedger({ entries }: Props) {
  if (entries.length === 0) return null

  return (
    <Card>
      <p className="mb-3 text-xs tracking-wide text-slate-400">DE ONDE VIERAM MEUS PONTOS</p>
      <ul className="space-y-2.5">
        {entries.map((e) => {
          const Icon = REASON_ICON[e.reason] ?? Sparkles
          const positivo = e.points > 0
          const rotulo = POINT_REASON_LABEL[e.reason] ?? e.reason
          // Nota igual ao rótulo (caso do 'Cadastro completo') não acrescenta nada.
          const nota = e.note && e.note !== rotulo ? e.note : null
          return (
            <li key={e.id} className="flex items-start gap-2.5">
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                  positivo
                    ? 'border-brand-500/30 bg-brand-500/10'
                    : 'border-rose-500/30 bg-rose-500/10',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', positivo ? 'text-brand-500' : 'text-rose-400')} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-200">{rotulo}</span>
                <span className="block text-xs text-slate-500">
                  {nota ? `${nota} · ` : ''}
                  {formatDate(e.created_at)}
                </span>
              </span>

              <span
                className={cn(
                  'shrink-0 text-sm font-bold tabular-nums',
                  positivo ? 'text-brand-500' : 'text-rose-400',
                )}
              >
                {positivo ? `+${e.points}` : e.points}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
