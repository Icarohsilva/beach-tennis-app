// features/liga/MedalsCard.tsx
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils/cn'
import { medalsForScope } from '@/lib/liga/medals'
import { sportLabel } from '@/lib/arenas/sports'
import { MedalIcon } from './MedalIcon'
import type { LigaMedal } from '@/types'

interface Props {
  medals: LigaMedal[]
  sport: string
}

/**
 * Vitrine das medalhas. Mostra as conquistadas E as que faltam, de propósito: a
 * medalha bloqueada é a que diz o que fazer em seguida ("10 aulas antes das 07:00"),
 * e uma vitrine só com o que já foi ganho não convida a nada.
 */
export function MedalsCard({ medals, sport }: Props) {
  const earned = new Set(medals.map((m) => `${m.medal_key}::${m.sport ?? ''}`))
  const isEarned = (key: string, scope: 'sport' | 'global') =>
    earned.has(`${key}::${scope === 'sport' ? sport : ''}`)

  const groups = [
    { title: sportLabel(sport).toUpperCase(), scope: 'sport' as const },
    { title: 'NA ACADEMIA', scope: 'global' as const },
  ]

  const total = medals.length
  const catalogTotal = medalsForScope('sport').length + medalsForScope('global').length

  return (
    <Card>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs text-slate-400 tracking-wide">MEDALHAS</p>
        <p className="text-xs text-slate-500">
          {total} de {catalogTotal}
        </p>
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.scope}>
            <p className="text-[10px] text-slate-500 tracking-wide mb-2">{group.title}</p>
            <ul className="grid grid-cols-4 gap-2">
              {medalsForScope(group.scope).map((medal) => {
                const has = isEarned(medal.key, group.scope)
                return (
                  <li
                    key={`${group.scope}-${medal.key}`}
                    title={`${medal.label}: ${medal.description}`}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-center',
                      has
                        ? 'border-brand-500/40 bg-brand-500/10'
                        : 'border-surface-border bg-surface/40',
                    )}
                  >
                    <MedalIcon
                      name={medal.icon}
                      className={cn('h-5 w-5', has ? 'text-brand-500' : 'text-slate-600')}
                    />
                    <span
                      className={cn(
                        'text-[10px] leading-tight',
                        has ? 'text-slate-200' : 'text-slate-500',
                      )}
                    >
                      {medal.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}
