// features/torneios/TournamentCard.tsx
// Card da vitrine de torneios.
//
// O card antigo mostrava nome, data e dois selos — e um deles era "Super 8"
// escrito à mão em TODO torneio, inclusive nos de padel com 20 vagas. Este aqui
// deriva tudo do dado: a capa que o admin subiu, a modalidade com cor própria,
// o formato real, o nível no vocabulário do esporte e quantas vagas sobraram.
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils/dateHelpers'
import { cn } from '@/lib/utils/cn'
import { priceLabel, spotsOf, type BrowseTournament, type Phase } from '@/lib/torneios/browse'
import { toneClasses } from './sportTone'
import {
  categoryLabel,
  competitorCountLabel,
  competitorNoun,
  formatLabel,
  levelLabel,
  participantLabel,
  sportChip,
} from '@/lib/torneios/sportProfile'

interface TournamentCardProps {
  tournament: BrowseTournament
  href: string
  phase: Phase
  /** Nome do campeão, quando o torneio já fechou o pódio. */
  champion?: string | null
  /** Ordem na cascata de entrada da página. */
  step?: number
}

export function TournamentCard({ tournament: t, href, phase, champion, step = 0 }: TournamentCardProps) {
  const sport = sportChip(t.sport)
  const tone = toneClasses(sport.tone)
  const spots = spotsOf(t)
  const isLive = phase === 'live'
  const isPast = phase === 'past'

  // Selos descritivos. Cada um só entra se disser algo — categoria "livre" num
  // torneio livre é ruído, e "Dupla fixa" não existe em crossfit individual.
  const chips = [
    formatLabel(t.format, t.max_players),
    levelLabel(t.level, t.sport),
    t.category !== 'livre' ? categoryLabel(t.category) : null,
    participantLabel(t.sport, t.participant_type),
  ].filter((c): c is string => !!c)

  return (
    <Link
      href={href}
      className="reveal group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      style={{ '--reveal-delay': `${step * 60}ms` } as React.CSSProperties}
    >
      <article
        className={cn(
          'relative overflow-hidden rounded-2xl border border-white/[0.07] bg-surface-card transition-all duration-200',
          'hover:-translate-y-0.5 hover:border-brand-600/50 active:scale-[0.995]',
          isPast && 'opacity-80 hover:opacity-100',
        )}
      >
        {/* ── Capa ───────────────────────────────────────────────────────────
            Com imagem, ela manda. Sem imagem, o card não fica órfão: pinta um
            degradê na cor da modalidade com a marca d'água do emoji. */}
        <div className="relative h-24 w-full overflow-hidden">
          {t.cover_image_url ? (
            <Image
              src={t.cover_image_url}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 50vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className={cn('absolute inset-0', tone.glow)}>
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgb(255_255_255/0.6)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.6)_1px,transparent_1px)] [background-size:22px_22px]"
              />
              <span
                aria-hidden
                className="absolute -bottom-3 right-2 select-none text-6xl opacity-20 transition-transform duration-500 group-hover:scale-110"
              >
                {sport.emoji}
              </span>
            </div>
          )}
          {/* Escurece a base para o título encostar na capa, e o topo para as
              pastilhas não sumirem sobre uma capa clara — a capa é foto que o
              admin sobe, então não dá para contar com o contraste dela. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-surface-card via-surface-card/55 to-transparent"
          />
          {t.cover_image_url && (
            <div aria-hidden className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/55 to-transparent" />
          )}

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm',
                tone.pill,
              )}
            >
              <span aria-hidden>{sport.emoji}</span>
              {sport.label}
            </span>

            <div className="flex shrink-0 items-center gap-1.5">
              {t.isMine && (
                <span className="rounded-full border border-brand-400/40 bg-brand-500/20 px-2 py-1 text-[11px] font-bold text-brand-200 backdrop-blur-sm">
                  Inscrito
                </span>
              )}
              {isLive && <LivePill />}
            </div>
          </div>
        </div>

        {/* ── Corpo ──────────────────────────────────────────────────────── */}
        <div className="relative -mt-5 space-y-2.5 p-3.5 pt-0">
          <div>
            <h3 className="text-[15px] font-bold leading-snug text-white">{t.name}</h3>
            {/* first-letter, não capitalize: date-fns devolve "sábado, 22 de agosto"
                e capitalize viraria "Sábado, 22 De Agosto". */}
            <p className="mt-0.5 text-xs font-medium text-slate-400 first-letter:uppercase">
              {formatDate(t.date, "EEEE, dd 'de' MMMM")}
            </p>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded-md border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-slate-300"
              >
                {chip}
              </li>
            ))}
          </ul>

          {isPast ? (
            <PastFooter champion={champion} count={t.occupiedCount} tournament={t} />
          ) : (
            <SpotsFooter tournament={t} spots={spots} />
          )}
        </div>
      </article>
    </Link>
  )
}

/** Pulso de "acontecendo agora" — o mesmo sinal que os apps de placar ao vivo usam. */
function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/25 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-red-100 backdrop-blur-sm">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-300 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-300" />
      </span>
      Ao vivo
    </span>
  )
}

/**
 * Rodapé de torneio que ainda vai acontecer: quantas vagas restam, quanto custa.
 * A barra é o que responde "dá tempo de entrar?" sem abrir o torneio.
 */
function SpotsFooter({ tournament: t, spots }: { tournament: BrowseTournament; spots: ReturnType<typeof spotsOf> }) {
  const noun = competitorNoun(t.sport, t.participant_type, true)

  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-2.5">
      {spots.total !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold">
            <span className="text-slate-400">
              {spots.taken}/{spots.total} {noun}
            </span>
            {spots.isFull ? (
              <span className="text-amber-300">
                Lotado{t.waitlistCount > 0 ? ` · ${t.waitlistCount} na espera` : ''}
              </span>
            ) : spots.isLastCall ? (
              <span className="text-amber-300">
                {spots.remaining === 1 ? 'Última vaga!' : `Restam ${spots.remaining} vagas`}
              </span>
            ) : (
              <span className="text-emerald-300">{spots.remaining} vagas</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                spots.isFull
                  ? 'bg-amber-400'
                  : spots.isLastCall
                    ? 'bg-gradient-to-r from-amber-500 to-amber-300'
                    : 'bg-gradient-to-r from-brand-600 to-brand-400',
              )}
              style={{ width: `${Math.max(spots.pct, 3)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              'font-bold',
              t.entry_price_cents && t.entry_price_cents > 0 ? 'text-white' : 'text-emerald-300',
            )}
          >
            {priceLabel(t.entry_price_cents)}
          </span>
          {spots.total === null && t.occupiedCount > 0 && (
            <span className="flex items-center gap-1 text-slate-400">
              <Users className="h-3.5 w-3.5" />
              {competitorCountLabel(t.occupiedCount, t.sport, t.participant_type)}
            </span>
          )}
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-400">
          {t.isMine ? 'Ver torneio' : 'Ver e inscrever'}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  )
}

/** Rodapé do que já passou: quem ganhou é a informação que sobra de valor. */
function PastFooter({
  champion,
  count,
  tournament: t,
}: {
  champion?: string | null
  count: number
  tournament: BrowseTournament
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2.5">
      {champion ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          <span aria-hidden>🏆</span>
          <span className="truncate font-semibold text-amber-200">{champion}</span>
        </span>
      ) : (
        <span className="text-xs text-slate-400">
          {count > 0 ? competitorCountLabel(count, t.sport, t.participant_type) : 'Encerrado'}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-400 transition-colors group-hover:text-brand-400">
        Resultados
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </div>
  )
}
