// features/torneios/NextMatchCard.tsx
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatMatchDateTime } from '@/lib/torneios/matchTime'
import type { NextMatchSummary } from './studentHome'
import { cn } from '@/lib/utils/cn'

export function NextMatchCard({ match }: { match: NextMatchSummary }) {
  return (
    <Link href={`/torneios/${match.tournamentId}`} className="block">
      <Card accent className="hover:border-brand-600/50 transition-colors">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-400">
          Próximo jogo
        </p>
        <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
          <span className={cn('truncate', match.mySide === 1 && 'text-brand-300')}>
            {match.team1}
          </span>
          <span className="shrink-0 text-xs font-normal text-slate-500">vs</span>
          <span className={cn('truncate', match.mySide === 2 && 'text-brand-300')}>
            {match.team2}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          <span aria-hidden>📅</span> {formatMatchDateTime(match.playedAt)} · {match.tournamentName}
        </p>
      </Card>
    </Link>
  )
}
