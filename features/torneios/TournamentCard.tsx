// features/torneios/TournamentCard.tsx
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Tournament, TournamentStatus } from '@/types'

interface TournamentCardProps {
  tournament: Tournament
  href: string
}

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}

const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  open: 'success',
  in_progress: 'warning',
  finished: 'danger',
}

const MODALITY_LABELS: Record<NonNullable<Tournament['modality']>, string> = {
  dupla_fixa: 'Dupla Fixa',
  dupla_revezando: 'Dupla Revezando',
}

export function TournamentCard({ tournament, href }: TournamentCardProps) {
  return (
    <Link href={href}>
      <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-white font-semibold text-sm leading-tight">{tournament.name}</span>
          <Badge variant={STATUS_VARIANTS[tournament.status]}>
            {STATUS_LABELS[tournament.status]}
          </Badge>
        </div>

        <p className="text-xs text-slate-400 mb-3">
          {formatDate(tournament.date, "dd 'de' MMMM 'de' yyyy")}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="level">Nível {tournament.level.toUpperCase()}</Badge>
          {tournament.modality && <Badge variant="default">{MODALITY_LABELS[tournament.modality]}</Badge>}
          <Badge variant="default">Super 8</Badge>
        </div>
      </Card>
    </Link>
  )
}
