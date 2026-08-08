// features/liga/SportTabs.tsx
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'
import { sportLabel, sportEmoji } from '@/lib/arenas/sports'

interface Props {
  sports: string[]
  active: string
}

/**
 * Alternância entre rankings. Só renderiza com mais de um esporte — quem pratica
 * uma modalidade só nunca vê essa complexidade.
 */
export function SportTabs({ sports, active }: Props) {
  if (sports.length <= 1) return null

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {sports.map((sport) => (
        <Link
          key={sport}
          href={`/liga?esporte=${encodeURIComponent(sport)}`}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors',
            sport === active
              ? 'border-brand-500 bg-brand-500/10 text-brand-500'
              : 'border-surface-border text-slate-400 hover:text-slate-200',
          )}
        >
          {sportEmoji(sport)} {sportLabel(sport)}
        </Link>
      ))}
    </div>
  )
}
