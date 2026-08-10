// features/torneios/TournamentHero.tsx
// Capa do torneio: o que ele é, quando é, e em que pé está.
//
// O hero anterior era um degradê com o nome e três pastilhas de texto. Este usa
// a capa que o admin subiu, fala no vocabulário da modalidade e mostra a
// ocupação — a informação que decide se vale se inscrever.
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDate } from '@/lib/utils/dateHelpers'
import { priceLabel, spotsOf } from '@/lib/torneios/browse'
import {
  categoryLabel,
  competitorNoun,
  formatLabel,
  levelLabel,
  participantLabel,
  sportChip,
} from '@/lib/torneios/sportProfile'
import { toneClasses } from './sportTone'
import type { StudentLevel, Tournament, TournamentStatus } from '@/types'

const STATUS: Record<TournamentStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'border-white/20 bg-white/10 text-white' },
  open: { label: 'Inscrições abertas', className: 'border-emerald-300/40 bg-emerald-400/20 text-emerald-50' },
  in_progress: { label: 'Acontecendo agora', className: 'border-red-300/40 bg-red-400/25 text-red-50' },
  finished: { label: 'Encerrado', className: 'border-white/20 bg-white/10 text-white/90' },
}

interface TournamentHeroProps {
  tournament: Tournament
  occupiedCount: number
  waitlistCount: number
  /** Slot à direita do cabeçalho (compartilhar, selo de ao vivo). */
  actions?: React.ReactNode
}

export function TournamentHero({
  tournament: t,
  occupiedCount,
  waitlistCount,
  actions,
}: TournamentHeroProps) {
  const sport = sportChip(t.sport)
  const tone = toneClasses(sport.tone)
  const spots = spotsOf({ occupiedCount, max_players: t.max_players })
  const status = STATUS[t.status]
  const noun = competitorNoun(t.sport, t.participant_type, true)

  const chips = [
    formatLabel(t.format, t.max_players),
    levelLabel(t.level as StudentLevel, t.sport),
    t.category !== 'livre' ? categoryLabel(t.category) : null,
    participantLabel(t.sport, t.participant_type),
  ].filter((c): c is string => !!c)

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10">
      {/* Fundo: capa quando existe, degradê de marca quando não. */}
      <div className="absolute inset-0">
        {t.cover_image_url ? (
          <>
            <Image src={t.cover_image_url} alt="" fill sizes="100vw" className="object-cover" priority />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-surface via-surface/85 to-surface/45" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
            />
            <div aria-hidden className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
          </div>
        )}
      </div>

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-2">
          <Link
            href="/torneios"
            aria-label="Voltar para a Arena"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm', tone.pill)}>
            <span aria-hidden>{sport.emoji}</span>
            {sport.label}
          </span>
          <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm', status.className)}>
            {status.label}
          </span>
        </div>

        <h1 className="mt-2 text-2xl font-extrabold leading-tight text-white">{t.name}</h1>
        <p className="mt-1 text-sm font-medium text-white/85 first-letter:uppercase">
          {formatDate(t.date, "EEEE, dd 'de' MMMM 'de' yyyy")}
        </p>

        <ul className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-md border border-white/15 bg-black/25 px-2 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm"
            >
              {chip}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-bold text-white">
            {spots.total !== null ? `${spots.taken}/${spots.total} ${noun}` : `${spots.taken} ${noun}`}
          </span>
          {t.status === 'open' && spots.total !== null && (
            <span className={cn('font-semibold', spots.isFull ? 'text-amber-300' : 'text-emerald-300')}>
              {spots.isFull
                ? `Lotado${waitlistCount > 0 ? ` · ${waitlistCount} na espera` : ''}`
                : `${spots.remaining} ${spots.remaining === 1 ? 'vaga' : 'vagas'}`}
            </span>
          )}
          <span className={cn('font-semibold', t.entry_price_cents ? 'text-white/90' : 'text-emerald-300')}>
            {priceLabel(t.entry_price_cents)}
          </span>
        </div>

        {spots.total !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                spots.isFull ? 'bg-amber-400' : 'bg-gradient-to-r from-brand-400 to-brand-200',
              )}
              style={{ width: `${Math.max(spots.pct, 3)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
