// features/liga/MedalsCard.tsx
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/utils/cn'
import { medalsForScope, type MedalDef } from '@/lib/liga/medals'
import { sportLabel } from '@/lib/arenas/sports'
import { MedalIcon } from './MedalIcon'
import type { LigaMedal } from '@/types'

interface Props {
  medals: LigaMedal[]
  sport: string
}

/** Quantas medalhas ainda bloqueadas mostrar como próximo objetivo. */
const PROXIMAS = 3

/**
 * Vitrine das medalhas.
 *
 * Conquistadas em destaque, e só TRÊS bloqueadas como próximo objetivo. A primeira
 * versão listava o catálogo inteiro numa grade: dava meia tela de ícones cinza, o que
 * comunica "quanto você ainda não tem" em vez de "o que você conquistou". Vitrine é
 * troféu, não checklist.
 */
export function MedalsCard({ medals, sport }: Props) {
  const earnedKeys = new Set(medals.map((m) => `${m.medal_key}::${m.sport ?? ''}`))
  const scopeKey = (m: MedalDef) => `${m.key}::${m.scope === 'sport' ? sport : ''}`

  const catalog = [...medalsForScope('sport'), ...medalsForScope('global')]
  const conquistadas = catalog.filter((m) => earnedKeys.has(scopeKey(m)))
  const proximas = catalog.filter((m) => !earnedKeys.has(scopeKey(m))).slice(0, PROXIMAS)

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs tracking-wide text-slate-400">MEDALHAS</p>
        <p className="text-xs text-slate-500">
          <span className="font-bold text-brand-500">{conquistadas.length}</span> de{' '}
          {catalog.length}
        </p>
      </div>

      {conquistadas.length === 0 ? (
        <p className="mb-4 text-sm text-slate-300">
          Nenhuma ainda. A primeira chega na sua 10ª aula de {sportLabel(sport)}.
        </p>
      ) : (
        <ul className="no-scrollbar rail-fade -mx-4 mb-4 flex gap-3 overflow-x-auto px-4">
          {conquistadas.map((medal) => (
            <li
              key={scopeKey(medal)}
              title={medal.description}
              className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-brand-400 via-brand-600 to-brand-800 shadow-lg shadow-brand-900/50">
                <MedalIcon name={medal.icon} className="h-6 w-6 text-white" />
              </span>
              <span className="text-[10px] font-medium leading-tight text-slate-200">
                {medal.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {proximas.length > 0 && (
        <>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
            Próximas
          </p>
          <ul className="space-y-1.5">
            {proximas.map((medal) => (
              <li key={`p-${scopeKey(medal)}`} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-surface-border bg-surface',
                  )}
                >
                  <MedalIcon name={medal.icon} className="h-4 w-4 text-slate-600" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-300">
                    {medal.label}
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {medal.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
