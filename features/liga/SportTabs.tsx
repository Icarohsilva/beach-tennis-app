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
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {sports.map((sport) => (
        <Link
          key={sport}
          href={`/liga?esporte=${encodeURIComponent(sport)}`}
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all active:scale-95',
            sport === active
              ? 'border-transparent bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-900/40'
              : 'border-surface-border text-slate-400 hover:border-brand-600/50 hover:text-slate-200',
          )}
        >
          {sportEmoji(sport)} {sportLabel(sport)}
        </Link>
      ))}
    </div>
  )
}
