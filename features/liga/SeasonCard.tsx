// features/liga/SeasonCard.tsx
import { Shield } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DIVISION_LABEL } from '@/lib/liga/labels'
import { sportLabel } from '@/lib/arenas/sports'
import type { LigaDivision } from '@/types'

interface Props {
  division: LigaDivision
  points: number
  position: number
  divisionSize: number
  pointsToPromote: number | null
  sport: string
  endsOn: string
}

/** Dias restantes até o fim da temporada, contando pelo relógio do servidor. */
function daysLeft(endsOn: string): number {
  const end = new Date(`${endsOn}T23:59:59`)
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000))
}

export function SeasonCard({
  division,
  points,
  position,
  divisionSize,
  pointsToPromote,
  sport,
  endsOn,
}: Props) {
  const progress =
    pointsToPromote === null
      ? 100
      : Math.min(100, Math.round((points / Math.max(1, points + pointsToPromote)) * 100))
  const dias = daysLeft(endsOn)

  return (
    <Card>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/30">
          <Shield className="h-6 w-6 text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{DIVISION_LABEL[division]}</p>
          <p className="text-xs text-slate-400">
            {position}º de {divisionSize} · {sportLabel(sport)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-brand-500 leading-none">{points}</p>
          <p className="text-xs text-slate-400">pontos</p>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-1.5">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-xs text-slate-400">
        {pointsToPromote === null
          ? `Temporada termina em ${dias} ${dias === 1 ? 'dia' : 'dias'}`
          : `${pointsToPromote} ${pointsToPromote === 1 ? 'ponto' : 'pontos'} para entrar na zona de promoção · termina em ${dias} ${dias === 1 ? 'dia' : 'dias'}`}
      </p>
    </Card>
  )
}
