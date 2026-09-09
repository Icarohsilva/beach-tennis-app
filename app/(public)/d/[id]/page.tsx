// app/(public)/d/[id]/page.tsx
// A página pública de UM day use — o link que a arena manda no grupo do
// WhatsApp. Abre sem login (ver a lista de rotas públicas em middleware.ts) e
// quem não tem conta reserva criando uma na hora, como no torneio (/t/[id]).
//
// A conta criada aqui NÃO vira membership da arena: é conta do aplicativo, e
// só. Por isso o estado "sua reserva" vive nesta página, e não em /home —
// aquela rota exige acesso de aluno, que o avulso não tem. É também por isso
// que a leitura usa o admin client: dayuse_slots_select_org exige vínculo.
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Clock, MapPin, Users } from 'lucide-react'
import { createAdminClient, getAuthUser } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { getSiteUrl } from '@/lib/utils/siteUrl'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { DAY_USE_KIND_LABEL, dayUseKindHint, formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { dayUseShareMessage, resolveDayUseCta } from '@/lib/dayuse/publicPage'
import { getPublicDayUse } from '@/features/dayuse/publicQuery'
import { buildWhatsAppUrl } from '@/lib/utils/whatsappLink'
import { DayUseBookButton, DayUseCancelButton } from './DayUseBookButton'
import { ShareDayUse } from './ShareDayUse'
import type { DayUseSlot } from '@/types'

interface PageProps { params: { id: string } }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Consulta enxuta e própria: generateMetadata roda numa passada separada da
  // página, então reusar getPublicDayUse aqui dobraria a leitura de reservas e
  // de configuração de cobrança sem nada disso aparecer no preview.
  const admin = createAdminClient()
  const { data: slotRaw } = await admin
    .from('dayuse_slots')
    .select('date, start_time, end_time, sport, organization_id')
    .eq('id', params.id)
    .eq('is_active', true)
    .maybeSingle()
  if (!slotRaw) return { title: 'Day Use | ArenaHub' }
  const slot = slotRaw as Pick<DayUseSlot, 'date' | 'start_time' | 'end_time' | 'sport'> & {
    organization_id: string
  }

  const { data: org } = await admin
    .from('organizations')
    .select('name, logo_url')
    .eq('id', slot.organization_id)
    .maybeSingle()

  const what = slot.sport ? `Day use de ${sportLabel(slot.sport)}` : 'Day use'
  const title = org?.name ? `${what} · ${org.name as string}` : what
  const description = `${formatDate(slot.date, "EEEE, dd 'de' MMMM")}, das ${formatTime(slot.start_time)} às ${formatTime(slot.end_time)}. Reserve sua vaga.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${getSiteUrl()}/d/${params.id}`,
      images: org?.logo_url ? [{ url: org.logo_url as string }] : [],
      type: 'website',
    },
    twitter: { card: 'summary', title },
  }
}

export default async function PublicDayUsePage({ params }: PageProps) {
  const user = await getAuthUser()
  const data = await getPublicDayUse(params.id, user?.id ?? null)
  if (!data) notFound()

  const { slot, org, priceCents, occupied, attendees, mine } = data

  const cta = resolveDayUseCta({
    date: slot.date,
    end_time: slot.end_time,
    capacity: slot.capacity,
    occupied,
    myStatus: mine?.status ?? null,
    signedIn: Boolean(user),
    priceCents,
    now: new Date(),
  })

  const dateLabel = formatDate(slot.date, "EEEE, dd 'de' MMMM")
  const shareMessage = dayUseShareMessage({
    orgName: org.name,
    sportLabel: slot.sport ? sportLabel(slot.sport) : null,
    kind: slot.kind,
    dateLabel,
    startLabel: formatTime(slot.start_time),
    endLabel: formatTime(slot.end_time),
    priceCents,
    url: `${getSiteUrl()}/d/${slot.id}`,
  })

  const place = [org.city, org.state].filter(Boolean).join(' · ')

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-4">
      {/* Hero: quem organiza vem primeiro. Quem abre pelo WhatsApp muitas vezes
          não sabe de qual arena é o link. */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/70">Day use</p>
        <h1 className="mt-1 text-xl font-bold text-white">
          {slot.sport ? `${sportEmoji(slot.sport)} ${sportLabel(slot.sport)}` : org.name}
        </h1>
        <p className="mt-1 text-sm text-white/80 first-letter:uppercase">{dateLabel}</p>
        <p className="mt-3 text-2xl font-bold text-white">{formatDayUsePrice(priceCents)}</p>
        {priceCents > 0 && <p className="text-xs text-white/70">por pessoa</p>}
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-surface-border bg-surface px-2 py-0.5 text-xs text-slate-300">
            {DAY_USE_KIND_LABEL[slot.kind]}
          </span>
          <span className="rounded-full border border-surface-border bg-surface px-2 py-0.5 text-xs text-slate-300">
            Espaço {slot.court}
          </span>
        </div>
        <p className="text-xs text-slate-400">{dayUseKindHint(slot.kind)}</p>
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {formatTime(slot.start_time)} às {formatTime(slot.end_time)}
          </li>
          <li className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {occupied}/{slot.capacity} {slot.kind === 'open' ? 'pessoas' : 'vagas ocupadas'}
          </li>
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            <span className="min-w-0">
              <Link href={`/arenas/${org.slug}`} className="text-brand-400 hover:text-brand-300">
                {org.name}
              </Link>
              {place && <span className="block text-xs text-slate-500">{place}</span>}
            </span>
          </li>
        </ul>
        {slot.notes && <p className="text-sm text-slate-400">{slot.notes}</p>}
      </Card>

      <Card className="space-y-3">
        {cta.actionable ? (
          <DayUseBookButton slotId={slot.id} label={cta.label} signedIn={Boolean(user)} />
        ) : (
          <p
            className={
              cta.state === 'booked' || cta.state === 'pending'
                ? 'text-center text-sm font-semibold text-green-400'
                : 'text-center text-sm font-semibold text-slate-300'
            }
          >
            {cta.label}
          </p>
        )}
        <p className="text-center text-xs text-slate-500">{cta.note}</p>
        {mine && cta.state === 'booked' && <DayUseCancelButton bookingId={mine.id} />}
        {cta.state === 'full' && org.whatsapp && (
          <a
            href={buildWhatsAppUrl(
              org.whatsapp,
              `Olá! O day use de ${dateLabel} às ${formatTime(slot.start_time)} está lotado. Consigo entrar se alguém desistir?`,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs text-green-400 hover:text-green-300"
          >
            Falar com a arena no WhatsApp
          </a>
        )}
        {!user && cta.actionable && (
          <p className="text-center text-xs text-slate-500">
            Já tem conta?{' '}
            <Link href={`/login?next=/d/${slot.id}`} className="text-brand-400 hover:text-brand-300">
              Entrar
            </Link>
          </p>
        )}
      </Card>

      {attendees.length > 0 && (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Quem já vai</p>
          <p className="mt-1 text-sm text-slate-300">{attendees.join(' · ')}</p>
        </Card>
      )}

      <ShareDayUse message={shareMessage} />

      <div className="pt-2 text-center">
        <PoweredBy />
      </div>
    </div>
  )
}
