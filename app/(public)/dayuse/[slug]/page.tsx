// app/(public)/dayuse/[slug]/page.tsx
// A página de um day use: o flyer no topo e as datas dele embaixo.
//
// É o link que a arena divulga no grupo. Mesmo desenho da página de evento de
// torneio (/e/[slug]): abre sem login, usa a cor da arena, mostra a capa
// inteira e leva direto à data escolhida — que continua reservando pela página
// dela (/d/[id]), onde moram pagamento, parceiro e "sua reserva".
export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { CalendarDays, Clock, MapPin, Sun, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { getPublicDayUsePage } from '@/features/dayuse/pageQueries'
import { accentVars } from '@/lib/branding/theme'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { Logo } from '@/components/ui/Logo'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { Button } from '@/components/ui/Button'
import { ShareButton } from '@/features/torneios/ShareButton'
import { groupPageSlots } from '@/lib/dayuse/pageView'
import { DAY_USE_KIND_LABEL, formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { DAY_USE_TIMING_STUDENT_LABEL } from '@/lib/dayuse/paymentMethod'
import { PARTNER_SHORT_LABEL } from '@/lib/dayuse/partnerCheckin'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { cn } from '@/lib/utils/cn'

interface PageProps {
  params: { slug: string }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { data } = await createAdminClient()
    .from('dayuse_pages')
    .select('name, description, cover_image_url')
    .eq('slug', params.slug)
    .eq('is_published', true)
    .maybeSingle()
  if (!data) return { title: 'Day use | ArenaHub' }

  const page = data as { name: string; description: string | null; cover_image_url: string | null }
  const description = page.description?.trim() || 'Escolha a data e reserve sua vaga.'
  return {
    title: page.name,
    description,
    openGraph: {
      title: page.name,
      description,
      url: `${getSiteUrl()}/dayuse/${params.slug}`,
      // Sem width/height: a capa costuma ser o flyer QUADRADO, e declarar
      // 1200x630 faz o WhatsApp recortar a arte como faixa (mesmo caso do evento).
      images: page.cover_image_url ? [{ url: page.cover_image_url }] : [],
      type: 'website',
    },
    twitter: {
      card: page.cover_image_url ? 'summary_large_image' : 'summary',
      title: page.name,
      description,
    },
  }
}

export default async function DayUsePublicPage({ params }: PageProps) {
  const data = await getPublicDayUsePage(params.slug)
  if (!data) notFound()

  const { page, org, slots } = data
  const groups = groupPageSlots(slots, new Date())
  const whatsapp = org.whatsapp?.replace(/\D/g, '') ?? ''
  const sports = Array.from(new Set(slots.map((s) => s.sport).filter((s): s is string => !!s)))

  return (
    <div style={accentVars(org.brand_color)} className="min-h-screen bg-surface text-white">
      {/* Capa inteira, na proporção dela, com o título embaixo: a capa real é o
          flyer, e recortar ou escurecer apagaria a arte (ver /e/[slug]). */}
      {page.cover_image_url ? (
        <div className="mx-auto max-w-2xl sm:px-4 sm:pt-4">
          <Image
            src={page.cover_image_url}
            alt={page.name}
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-200">
              <Sun className="h-3 w-3" aria-hidden />
              Day use
            </span>
            <h1 className="mt-2 text-2xl font-extrabold leading-tight text-white sm:text-3xl">
              {page.name}
            </h1>
          </div>
          <div className="shrink-0">
            <ShareButton path={`/dayuse/${page.slug}`} title={page.name} what="day use" />
          </div>
        </div>

        <div className="space-y-1.5 text-sm">
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
          {sports.length > 0 && (
            <p className="flex items-center gap-2 text-slate-300">
              <span aria-hidden className="w-4 text-center">{sportEmoji(sports[0])}</span>
              {sports.map((s) => sportLabel(s)).join(' · ')}
            </p>
          )}
        </div>

        {/* ── Datas ───────────────────────────────────────────────────────────
            Antes da descrição: quem chega pelo grupo já leu o post, e no
            celular o texto empurrava a reserva para a terceira rolagem. */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
            <CalendarDays className="h-4 w-4 text-brand-500" aria-hidden />
            Escolha sua data
          </h2>

          {groups.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.07] bg-surface-card px-4 py-8 text-center text-sm text-slate-400">
              As próximas datas deste day use ainda vão ser divulgadas.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.date}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 first-letter:uppercase">
                    {formatDate(group.date, "EEEE, dd 'de' MMMM")}
                  </p>
                  <div className="space-y-2">
                    {group.items.map(({ slot, full, vacancyLabel }) => (
                      <div
                        key={slot.id}
                        className={cn(
                          'rounded-2xl border border-white/[0.07] bg-surface-card p-4',
                          full && 'opacity-70',
                        )}
                      >
                        <div className="flex flex-col gap-3 xs:flex-row xs:items-center xs:justify-between">
                          <div className="min-w-0 space-y-1">
                            <p className="flex items-center gap-2 text-base font-bold text-white">
                              <Clock className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
                              {formatTime(slot.start_time)} às {formatTime(slot.end_time)}
                            </p>
                            <p className="text-xs text-slate-400">
                              {DAY_USE_KIND_LABEL[slot.kind]} · Espaço {slot.court}
                            </p>
                            <p className="text-sm text-slate-200">
                              <span className="font-semibold text-white">{formatDayUsePrice(slot.priceCents)}</span>
                              {slot.priceCents > 0 && (
                                <span className="text-xs text-slate-400">
                                  {' '}· {DAY_USE_TIMING_STUDENT_LABEL[slot.timing].toLowerCase()}
                                </span>
                              )}
                            </p>
                            {slot.partners.length > 0 && (
                              <p className="text-xs text-emerald-300">
                                Aceita {slot.partners.map((p) => PARTNER_SHORT_LABEL[p]).join(' e ')}
                              </p>
                            )}
                            <p
                              className={cn(
                                'flex items-center gap-1 text-xs',
                                full ? 'text-red-300' : 'text-slate-400',
                              )}
                            >
                              <Users className="h-3.5 w-3.5" aria-hidden />
                              {vacancyLabel}
                            </p>
                          </div>
                          <Link href={`/d/${slot.id}`} className="shrink-0">
                            <Button size="md" variant={full ? 'secondary' : 'primary'} className="w-full xs:w-auto">
                              {full ? 'Ver detalhes' : 'Reservar'}
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {page.description && (
          <section className="space-y-3">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-white">Sobre o day use</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
              {page.description}
            </p>
          </section>
        )}

        {/* ── Contato ─────────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-white/[0.07] bg-surface-card p-4">
          <div className="flex items-center gap-3">
            <Logo variant="icon" size="sm" logoUrl={org.logo_url} orgName={org.name} />
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-white">{org.name}</p>
          </div>
          <div className="mt-3 flex flex-col gap-2 xs:flex-row">
            {whatsapp && (
              <a
                href={buildWhatsAppUrl(whatsapp, `Oi! Vi o ${page.name} e quero saber mais.`)}
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

        <div className="flex justify-center pt-2">
          <PoweredBy />
        </div>
      </div>
    </div>
  )
}
