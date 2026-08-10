// features/explorar/ArenaCard.tsx
// A arena na lista de descoberta.
//
// O que decide o clique não é o nome da arena, é o que está acontecendo nela.
// Por isso torneio aberto e day use livre vêm antes das modalidades, e arena
// parada aparece mais discreta em vez de sumir — ela ainda serve para marcar
// aula experimental.
import Link from 'next/link'
import { ArrowRight, CalendarDays, MapPin, Sun, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { sportChip } from '@/lib/torneios/sportProfile'
import { toneClasses } from '@/features/torneios/sportTone'
import { formatDistance, hasSomethingOpen, type ArenaWithDistance } from '@/lib/explorar/nearby'

/** Quantas modalidades cabem antes de virar "+N". */
const MAX_SPORTS = 3

export function ArenaCard({ arena, step = 0 }: { arena: ArenaWithDistance; step?: number }) {
  const distance = formatDistance(arena.distanceM)
  const active = hasSomethingOpen(arena)
  const shown = arena.sports.slice(0, MAX_SPORTS)
  const rest = arena.sports.length - shown.length

  const local = [arena.neighborhood, arena.city, arena.state].filter(Boolean).join(', ')

  return (
    <Link
      href={`/arenas/${arena.slug}`}
      className="reveal group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={{ '--reveal-delay': `${step * 60}ms` } as React.CSSProperties}
    >
      <article
        className={cn(
          'rounded-2xl border bg-surface-card p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-600/50',
          active ? 'border-white/[0.09]' : 'border-white/[0.05] opacity-90',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-bold leading-snug text-white">{arena.name}</h3>
            {local && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                {local}
              </p>
            )}
          </div>
          {distance && (
            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold text-slate-300">
              {distance}
            </span>
          )}
        </div>

        {shown.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {shown.map((slug) => {
              const chip = sportChip(slug)
              return (
                <li
                  key={slug}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                    toneClasses(chip.tone).pill,
                  )}
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.label}
                </li>
              )
            })}
            {rest > 0 && (
              <li className="rounded-full border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                +{rest}
              </li>
            )}
          </ul>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {arena.openTournaments > 0 && (
              <span className="flex items-center gap-1 font-semibold text-brand-300">
                <Trophy className="h-3.5 w-3.5" aria-hidden />
                {arena.openTournaments} {arena.openTournaments === 1 ? 'torneio' : 'torneios'}
              </span>
            )}
            {arena.openDayUse > 0 && (
              <span className="flex items-center gap-1 font-semibold text-sky-300">
                <Sun className="h-3.5 w-3.5" aria-hidden />
                {arena.openDayUse} day use
              </span>
            )}
            {!active && (
              <span className="flex items-center gap-1 text-slate-400">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Aula experimental
              </span>
            )}
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-500 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-brand-400" />
        </div>
      </article>
    </Link>
  )
}
