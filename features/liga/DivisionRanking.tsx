// features/liga/DivisionRanking.tsx
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils/cn'
import type { RankingEntry } from './queries'

interface Props {
  entries: RankingEntry[]
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export function DivisionRanking({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-300">
          Ninguém pontuou nessa modalidade ainda. Sua próxima aula já entra no ranking.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">RANKING DA DIVISÃO</p>
      <ul>
        {entries.map((e) => (
          <li
            key={e.studentId}
            className={cn(
              'flex items-center gap-2.5 py-1.5',
              e.isMe && 'bg-brand-500/10 border-l-2 border-brand-500 -mx-2 px-2',
            )}
          >
            <span
              className={cn('w-5 text-xs', e.isMe ? 'text-brand-500 font-medium' : 'text-slate-400')}
            >
              {e.position}
            </span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-border text-[10px] text-slate-300 shrink-0">
              {initials(e.fullName)}
            </span>
            <span
              className={cn(
                'flex-1 text-sm truncate',
                e.isMe ? 'text-white font-medium' : 'text-slate-200',
              )}
            >
              {e.isMe ? 'Você' : e.fullName}
            </span>
            <span
              className={cn('text-xs', e.isMe ? 'text-brand-500 font-medium' : 'text-slate-400')}
            >
              {e.points}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
