// app/(public)/e/[slug]/page.tsx
// A capa pública de um evento: "Copa de Agosto" com os torneios dela dentro.
//
// É a página que a academia divulga no Instagram. Abre sem login, usa a cor de
// marca da arena e leva a pessoa direto ao torneio da categoria dela — em vez
// de obrigar a academia a postar seis links e a pessoa a adivinhar qual é o seu.
export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarDays, MapPin, Trophy, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { getEventBySlug } from '@/features/torneios/eventQueries'
import { accentVars } from '@/lib/branding/theme'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { Logo } from '@/components/ui/Logo'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { MarkdownDoc } from '@/components/docs/MarkdownDoc'
import { ShareButton } from '@/features/torneios/ShareButton'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import { EventStat } from '@/features/torneios/EventStat'
import {
  eventPhase,
  eventPhaseLabel,
  eventStartTime,
  formatEventRange,
  formatStartTime,
  sortEventTournaments,
  summarizeEvent,
} from '@/lib/torneios/event'
import { sportChip } from '@/lib/torneios/sportProfile'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import type { BrowseTournament } from '@/lib/torneios/browse'
import { cn } from '@/lib/utils/cn'
import { brtToday } from '@/lib/utils/gridSchedule'

interface PageProps {
  params: { slug: string }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { data } = await createAdminClient()
    .from('tournament_events')
    .select('name, description, starts_on, ends_on, cover_image_url')
    .eq('slug', params.slug)
    .eq('is_published', true)
    .maybeSingle()

  if (!data) return { title: 'Evento | ArenaHub' }

  const event = data as {
    name: string
    description: string | null
    starts_on: string
    ends_on: string | null
    cover_image_url: string | null
  }
  const when = formatEventRange(event)
  const description = event.description?.trim() || `Inscrições abertas · ${when}`

  return {
    title: event.name,
    description,
    openGraph: {
      title: event.name,
      description,
      url: `${getSiteUrl()}/e/${params.slug}`,
      // Sem width/height: a capa costuma ser o flyer QUADRADO do evento, e
      // declarar 1200x630 fazia o WhatsApp recortar a arte como se fosse faixa.
      images: event.cover_image_url ? [{ url: event.cover_image_url }] : [],
      type: 'website',
    },
    twitter: {
      card: event.cover_image_url ? 'summary_large_image' : 'summary',
      title: event.name,
      description,
    },
  }
}

export default async function EventoPage({ params }: PageProps) {
  const data = await getEventBySlug(params.slug)
  if (!data) notFound()

  const { event, org, tournaments } = data
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h
  const phase = eventPhase(event, today)
  const summary = summarizeEvent(tournaments)
  const ordered = sortEventTournaments(tournaments)
  const whatsapp = org.whatsapp?.replace(/\D/g, '') ?? ''
  const startTime = eventStartTime(tournaments)

  const asBrowse = (t: (typeof tournaments)[number]): BrowseTournament => ({
    id: t.id,
    name: t.name,
    date: t.date,
    sport: t.sport,
    status: t.status as BrowseTournament['status'],
    level: t.level as BrowseTournament['level'],
    category: t.category as BrowseTournament['category'],
    participant_type: t.participant_type,
    format: t.format as BrowseTournament['format'],
    cover_image_url: null,
    entry_price_cents: t.entry_price_cents,
    max_players: t.max_players,
    occupiedCount: t.occupiedCount,
    waitlistCount: 0,
    isMine: false,
  })

  return (
    <div style={accentVars(org.brand_color)} className="min-h-screen bg-surface text-white">
      {/* ── Capa ────────────────────────────────────────────────────────────
          Com imagem, ela aparece INTEIRA, na proporção dela, e o título vem
          embaixo. Antes a capa virava fundo recortado a 224px e escurecido a
          85% para o título caber por cima — funciona com foto de quadra, mas a
          capa real de um evento é o FLYER, com a arte e o texto já desenhados:
          recortado e escurecido, ele sumia justamente onde mais aparece, no
          celular. Sem imagem, segue o degradê com o título por cima. */}
      {event.cover_image_url ? (
        <div className="mx-auto max-w-2xl sm:px-4 sm:pt-4">
          <Image
            src={event.cover_image_url}
            alt={event.name}
            width={1200}
            height={1200}
            sizes="(min-width: 672px) 672px, 100vw"
            className="h-auto w-full sm:rounded-2xl"
            priority
          />
        </div>
      ) : (
        <div className="h-32 w-full bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 sm:h-40">
          <div
            aria-hidden
            className="h-full w-full opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
          />
        </div>
      )}

      <div className="mx-auto max-w-2xl space-y-5 px-4 pb-12 pt-4">
        {/* ── Título ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 xs:flex-row xs:items-start xs:justify-between">
          <div className="min-w-0">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
                phase === 'running'
                  ? 'border-red-400/40 bg-red-500/20 text-red-100'
                  : phase === 'past'
                    ? 'border-white/15 bg-white/5 text-white/70'
                    : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
              )}
            >
              {phase === 'running' && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-300 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-300" />
                </span>
              )}
              {eventPhaseLabel(phase)}
            </span>
            <h1 className="mt-2 text-2xl font-extrabold leading-tight text-white sm:text-3xl">
              {event.name}
            </h1>
          </div>
          <div className="shrink-0">
            <ShareButton path={`/e/${event.slug}`} title={event.name} what="evento" />
          </div>
        </div>

        {/* ── Quando e onde ───────────────────────────────────────────────── */}
        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 font-semibold text-white first-letter:uppercase">
            <CalendarDays className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
            {/* A hora vem do torneio que começa primeiro: o evento não tem hora
                própria, e sem ela aqui a arena repetia data e local dentro da
                descrição só para dizer "14h". */}
            {formatEventRange(event)}
            {startTime ? ` · ${formatStartTime(startTime)}` : ''}
          </p>
          <Link
            href={`/arenas/${org.slug}`}
            className="flex items-center gap-2 text-slate-300 transition-colors hover:text-brand-300"
          >
            <MapPin className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
            <span className="min-w-0 truncate">
              {org.name}
              {org.city ? ` · ${org.city}` : ''}
              {org.state ? `/${org.state}` : ''}
            </span>
          </Link>
          {event.venue && (
            <p className="flex items-center gap-2 text-slate-300">
              <MapPin className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
              <span className="min-w-0">{event.venue}</span>
            </p>
          )}
        </div>

        {/* ── Números do evento ─────────────────────────────────────────────
            Só aparecem quando alguém já se inscreveu. "Inscritos 0" num link que
            acabou de ser divulgado é prova social ao contrário — diz a quem
            chega que ninguém quis ir. */}
        {summary.entrants > 0 && (
          <dl className="grid grid-cols-3 gap-2">
            <EventStat label={summary.total === 1 ? 'Torneio' : 'Torneios'} value={summary.total} />
            <EventStat label="Abertas" value={summary.open} tone="emerald" />
            <EventStat label="Inscritos" value={summary.entrants} />
          </dl>
        )}

        {/* ── Torneios ────────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
            <Trophy className="h-4 w-4 text-brand-500" aria-hidden />
            Escolha sua categoria
          </h2>

          {ordered.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-surface-card px-4 py-8 text-center text-sm text-slate-400">
              As categorias deste evento ainda vão ser divulgadas.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {ordered.map((t, i) => (
                <div key={t.id}>
                  <TournamentCard
                    tournament={asBrowse(t)}
                    href={`/t/${t.id}`}
                    phase={t.status === 'open' ? 'open' : t.status === 'in_progress' ? 'live' : 'past'}
                    step={i}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Sobre o evento ─────────────────────────────────────────────────
            Depois das categorias, e não antes: quem chega pelo WhatsApp já leu
            o texto do post, e no celular a descrição empurrava o botão de
            inscrição para a terceira rolagem. */}
        {(event.description || event.rules) && (
          <section className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-white">
              Sobre o evento
            </h2>
            {event.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                {event.description}
              </p>
            )}
            {event.rules && (
              <details className="rounded-2xl border border-white/[0.07] bg-surface-card p-4">
                <summary className="cursor-pointer text-sm font-semibold text-white">📋 Regulamento</summary>
                <div className="mt-3">
                  <MarkdownDoc content={event.rules} />
                </div>
              </details>
            )}
          </section>
        )}

        {/* ── Contato ─────────────────────────────────────────────────────── */}
        {(whatsapp || summary.sports > 0) && (
          <section className="rounded-2xl border border-white/[0.07] bg-surface-card p-4">
            <div className="flex items-center gap-3">
              <Logo variant="icon" size="sm" logoUrl={org.logo_url} orgName={org.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{org.name}</p>
                {summary.sports > 0 && (
                  <p className="truncate text-xs text-slate-400">
                    {Array.from(new Set(tournaments.map((t) => t.sport)))
                      .map((s) => sportChip(s).label)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
            {/* Empilhados abaixo de 400px: lado a lado, em 360px, cada rótulo
                quebrava em duas linhas. */}
            <div className="mt-3 flex flex-col gap-2 xs:flex-row">
              {whatsapp && (
                <a
                  href={buildWhatsAppUrl(
                    whatsapp,
                    `Oi! Vi o ${event.name} e quero saber mais.`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-[#0b1a12] transition-opacity hover:opacity-90"
                >
                  <Users className="h-4 w-4" />
                  Falar com a arena
                </a>
              )}
              <Link
                href={`/arenas/${org.slug}`}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-brand-600/50"
              >
                Conhecer a arena
              </Link>
            </div>
          </section>
        )}

        <div className="flex justify-center pt-2">
          <PoweredBy />
        </div>
      </div>
    </div>
  )
}
