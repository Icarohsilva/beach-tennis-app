// app/arenas/[slug]/page.tsx
// A página da arena — o link que ela põe na bio do Instagram.
//
// Antes daqui só cabia aula experimental, e a arena não tinha nada para
// compartilhar: quem clicava não descobria que havia torneio aberto, day use no
// sábado ou foto do último americano. Agora a página é a vitrine inteira, nas
// cores que a própria arena configurou, e abre sem login.
export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
// AtSign e não um ícone do Instagram: o lucide desta versão não traz ícones de
// marca, e um "@" diz a mesma coisa sem imagem de terceiro no bundle.
import { AtSign, CalendarDays, Clock, MapPin, Megaphone, Sun, Trophy } from 'lucide-react'
import { createAdminClient, getMemberships } from '@/lib/supabase/server'
import { getOpenTrialSessions } from '@/lib/arenas/sessions'
import { getArenaShowcase } from '@/features/torneios/eventQueries'
import { getRecentOrgPhotos } from '@/features/torneios/photoQueries'
import { sportChip } from '@/lib/torneios/sportProfile'
import { toneClasses } from '@/features/torneios/sportTone'
import { formatAddress } from '@/lib/arenas/formatAddress'
import { instagramUrl, normalizeInstagram } from '@/lib/arenas/instagram'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { accentVars } from '@/lib/branding/theme'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { cn } from '@/lib/utils/cn'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { EventStat } from '@/features/torneios/EventStat'
import { EventTeaser } from '@/features/torneios/EventTeaser'
import { PhotoGallery } from '@/features/torneios/PhotoGallery'
import { ShareButton } from '@/features/torneios/ShareButton'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import type { BrowseTournament } from '@/lib/torneios/browse'
import { TrialBookingForm } from './TrialBookingForm'
import { brtToday } from '@/lib/utils/gridSchedule'

const ARENA_COLUMNS =
  'id, name, slug, status, is_listed, city, state, neighborhood, address_line, address_number, no_number, sports, whatsapp, instagram, brand_color, logo_url'

interface ArenaRow {
  id: string
  name: string
  slug: string
  status: string
  is_listed: boolean
  city: string | null
  state: string | null
  neighborhood: string | null
  address_line: string | null
  address_number: string | null
  no_number: boolean
  sports: string[]
  whatsapp: string | null
  instagram: string | null
  brand_color: string | null
  logo_url: string | null
}

interface PageProps {
  params: { slug: string }
}

/** A arena só é pública se está ativa, listada e com cidade preenchida. */
function visible(org: ArenaRow | null): org is ArenaRow {
  return !!org && org.status === 'active' && org.is_listed && !!org.city
}

async function loadArena(slug: string): Promise<ArenaRow | null> {
  const { data } = await createAdminClient()
    .from('organizations')
    .select(ARENA_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()
  return (data as ArenaRow | null) ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const org = await loadArena(params.slug)
  if (!visible(org)) return { title: 'Arena | ArenaHub' }

  const local = [org.neighborhood, org.city, org.state].filter(Boolean).join(', ')
  const sports = org.sports.map((s) => sportChip(s).label).join(' · ')
  const description = [sports, local].filter(Boolean).join(' — ') || 'Aula experimental, day use e torneios.'

  return {
    title: org.name,
    description,
    openGraph: {
      title: org.name,
      description,
      url: `${getSiteUrl()}/arenas/${org.slug}`,
      // O logo é o único material visual que toda arena tem. Sem ele, o preview
      // do WhatsApp fica só com texto — melhor que uma imagem quebrada.
      images: org.logo_url ? [{ url: org.logo_url }] : [],
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: org.name,
      description,
    },
  }
}

export default async function ArenaPage({ params }: PageProps) {
  const org = await loadArena(params.slug)
  if (!visible(org)) notFound()

  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h

  const [showcase, sessions, photos, memberships] = await Promise.all([
    getArenaShowcase(org.id, today),
    getOpenTrialSessions(org.id),
    getRecentOrgPhotos(org.id, 6),
    getMemberships(),
  ])

  // Quem já é da casa vai direto para a reserva; visitante precisa de conta
  // antes, e mandá-lo para uma página que a RLS deixa vazia seria pior que
  // pedir o cadastro.
  const isMember = memberships.some((m) => m.organization_id === org.id)

  const whatsapp = org.whatsapp?.replace(/\D/g, '') ?? ''
  const address = formatAddress(org)
  const local = [address, org.neighborhood, org.city, org.state].filter(Boolean).join(' · ')
  // Normaliza na leitura também: a coluna é antiga o suficiente para ter linha
  // gravada antes de a action limpar o valor.
  const instagram = normalizeInstagram(org.instagram)
  const instaHref = instagramUrl(org.instagram)

  const openTournaments = showcase.looseTournaments.length
  const eventCount = showcase.events.length
  const dayUseCount = showcase.dayUse.length

  const asBrowse = (t: (typeof showcase.looseTournaments)[number]): BrowseTournament => ({
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
          Sem foto de fachada no cadastro, a faixa é a cor da marca: é o que
          diferencia a página de uma arena da outra à primeira vista. */}
      <div className="relative h-32 w-full bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 sm:h-40">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:28px_28px]"
        />
        <div className="absolute right-3 top-3">
          <ShareButton path={`/arenas/${org.slug}`} title={org.name} what="arena" />
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pb-12">
        {/* ── Identidade ───────────────────────────────────────────────────
            `relative z-10` não é enfeite: a faixa da capa é `relative` e
            elemento posicionado pinta acima de estático no mesmo contexto, então
            sem isto o logo (que sobe com -mt-10) fica atrás dela. */}
        <div className="relative z-10 -mt-10 flex items-end gap-3">
          <div className="rounded-2xl border border-white/[0.08] bg-surface-card p-2 shadow-lg">
            <Logo variant="icon" size="lg" logoUrl={org.logo_url} orgName={org.name} />
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-extrabold leading-tight text-white sm:text-3xl">
          {org.name}
        </h1>
        {local && (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-400">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden />
            <span>{local}</span>
          </p>
        )}

        {org.sports.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {org.sports.map((slug) => {
              const chip = sportChip(slug)
              return (
                <li
                  key={slug}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                    toneClasses(chip.tone).pill,
                  )}
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.label}
                </li>
              )
            })}
          </ul>
        )}

        {/* ── Contato ────────────────────────────────────────────────────── */}
        <div className="mt-4 flex flex-wrap gap-2">
          {whatsapp && (
            <a
              href={buildWhatsAppUrl(whatsapp, `Oi! Vi a página da ${org.name} e quero saber mais.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-bold text-[#0b1a12] transition-opacity hover:opacity-90"
            >
              💬 Falar no WhatsApp
            </a>
          )}
          {instagram && instaHref && (
            <a
              href={instaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-brand-600/50"
            >
              <AtSign className="h-4 w-4" aria-hidden />
              {instagram}
            </a>
          )}
        </div>

        {/* ── O que está acontecendo ─────────────────────────────────────── */}
        {(eventCount > 0 || openTournaments > 0 || dayUseCount > 0) && (
          <dl className="mt-5 grid grid-cols-3 gap-2">
            <EventStat
              label={eventCount === 1 ? 'Evento' : 'Eventos'}
              value={eventCount}
              tone={eventCount > 0 ? 'brand' : undefined}
            />
            <EventStat
              label={openTournaments === 1 ? 'Torneio' : 'Torneios'}
              value={openTournaments}
              tone={openTournaments > 0 ? 'emerald' : undefined}
            />
            <EventStat label="Day use" value={dayUseCount} />
          </dl>
        )}

        {/* ── Comunicados ────────────────────────────────────────────────── */}
        {showcase.notices.length > 0 && (
          <section className="mt-6">
            <SectionTitle icon={Megaphone}>Comunicados</SectionTitle>
            <ul className="space-y-2">
              {showcase.notices.map((n) => (
                <li
                  key={n.id}
                  className="rounded-2xl border border-brand-600/25 bg-brand-500/[0.07] p-3.5"
                >
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
                    {n.content}
                  </p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {formatDate(n.created_at.slice(0, 10), "dd 'de' MMMM")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Eventos ────────────────────────────────────────────────────── */}
        {showcase.events.length > 0 && (
          <section className="mt-6">
            <SectionTitle icon={Trophy}>Próximos eventos</SectionTitle>
            <div className="space-y-3">
              {showcase.events.map((e, i) => (
                <EventTeaser key={e.id} event={e} step={i} />
              ))}
            </div>
          </section>
        )}

        {/* ── Torneios avulsos ───────────────────────────────────────────── */}
        {showcase.looseTournaments.length > 0 && (
          <section className="mt-6">
            <SectionTitle icon={Trophy}>Torneios com inscrição aberta</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {showcase.looseTournaments.map((t, i) => (
                <TournamentCard
                  key={t.id}
                  tournament={asBrowse(t)}
                  href={`/t/${t.id}`}
                  phase="open"
                  step={i}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Day use ────────────────────────────────────────────────────── */}
        {showcase.dayUse.length > 0 && (
          <section className="mt-6">
            <SectionTitle icon={Sun}>Day use</SectionTitle>
            <Card>
              <ul className="divide-y divide-white/[0.06]">
                {showcase.dayUse.map((slot) => (
                  <li key={slot.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white first-letter:uppercase">
                        {formatDate(slot.date, "EEEE, dd 'de' MMMM")}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {formatTime(slot.start_time)} às {formatTime(slot.end_time)} · Quadra{' '}
                        {slot.court}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link
                href={isMember ? '/agendar/dayuse' : '/cadastro'}
                className="mt-3 flex w-full items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
              >
                {isMember ? 'Reservar day use' : 'Criar conta grátis para reservar'}
              </Link>
            </Card>
          </section>
        )}

        {/* ── Aula experimental ──────────────────────────────────────────── */}
        <section className="mt-6">
          <SectionTitle icon={CalendarDays}>Aula experimental</SectionTitle>
          <Card>
            {sessions.length === 0 ? (
              <div className="py-6 text-center">
                <p className="mb-1 text-sm text-slate-400">
                  Nenhuma sessão disponível nos próximos 30 dias.
                </p>
                <p className="text-xs text-slate-500">Fale com a arena para combinar uma data.</p>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-400">
                  Gratuita na primeira vez. Sem precisar criar conta.
                </p>
                <TrialBookingForm organizationId={org.id} sessions={sessions} />
              </>
            )}
          </Card>
        </section>

        {/* ── Fotos ──────────────────────────────────────────────────────── */}
        {photos.length > 0 && (
          <section className="mt-6">
            <SectionTitle icon={Trophy}>Fotos</SectionTitle>
            <PhotoGallery photos={photos} title="ÚLTIMOS TORNEIOS" />
          </section>
        )}

        <div className="mt-8 flex justify-center">
          <PoweredBy />
        </div>
      </div>
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
      <Icon className="h-4 w-4 text-brand-500" aria-hidden />
      {children}
    </h2>
  )
}
