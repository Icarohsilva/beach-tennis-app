// features/torneios/EventTeaser.tsx
// O evento como chamada na vitrine da arena.
//
// Maior que o card de torneio de propósito: o evento é o cartaz da temporada, e
// a página da arena existe para levar a pessoa até ele.
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Trophy } from 'lucide-react'
import { formatEventRange, type EventDates } from '@/lib/torneios/event'

interface EventTeaserProps {
  event: EventDates & {
    name: string
    slug: string
    cover_image_url: string | null
    tournamentCount: number
  }
  step?: number
}

export function EventTeaser({ event, step = 0 }: EventTeaserProps) {
  return (
    <Link
      href={`/e/${event.slug}`}
      className="reveal group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={{ '--reveal-delay': `${step * 60}ms` } as React.CSSProperties}
    >
      <article className="relative h-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-card transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-600/50 sm:h-44">
        {event.cover_image_url ? (
          <Image
            src={event.cover_image_url}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 640px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-600 to-brand-900">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgb(255_255_255/0.6)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.6)_1px,transparent_1px)] [background-size:24px_24px]"
            />
          </div>
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10"
        />

        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="text-lg font-extrabold leading-tight text-white sm:text-xl">{event.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/85">
            <span className="flex items-center gap-1 first-letter:uppercase">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {formatEventRange(event)}
            </span>
            {event.tournamentCount > 0 && (
              <span className="flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" aria-hidden />
                {event.tournamentCount === 1
                  ? '1 categoria'
                  : `${event.tournamentCount} categorias`}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-brand-300">
              Ver e inscrever
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}
