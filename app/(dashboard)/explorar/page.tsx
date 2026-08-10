// app/(dashboard)/explorar/page.tsx
// Descoberta: as arenas da região e o que está aberto nelas.
//
// É a casa de quem entrou sem academia — e um atalho para quem já é aluno de
// uma e quer jogar um torneio em outra. Diferente do resto do app, esta página
// NÃO é escopada por academia: ela mostra tudo que as arenas escolheram tornar
// público (`organizations.is_listed`).
//
// O torneio daqui aponta para a página pública `/t/[id]`, não para
// `/torneios/[id]`: a rota interna pressupõe vínculo com a academia, e a
// pública já tem o fluxo de inscrição de quem vem de fora.
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Compass, MapPin, Trophy } from 'lucide-react'
import { getAuthUser, getMemberships } from '@/lib/supabase/server'
import { getDiscoverData } from '@/features/explorar/queries'
import { ArenaCard } from '@/features/explorar/ArenaCard'
import { GeoButton } from '@/features/explorar/GeoButton'
import { JoinByCodeCard } from '@/features/explorar/JoinByCodeCard'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { hasStudentAccess } from '@/lib/org/activeOrg'
import { cityFacets, parsePosition, rankArenas } from '@/lib/explorar/nearby'
import type { BrowseTournament } from '@/lib/torneios/browse'
import { cn } from '@/lib/utils/cn'
import { brtToday } from '@/lib/utils/gridSchedule'

/** Quantos torneios em destaque antes de virar rolagem infinita de card. */
const MAX_TOURNAMENTS = 8

interface PageProps {
  searchParams: { lat?: string; lng?: string; cidade?: string }
}

export default async function ExplorarPage({ searchParams }: PageProps) {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  // BRT: com o UTC cru, depois das 21h os eventos de hoje saíam da descoberta.
  const today = brtToday(new Date())
  const [{ arenas, tournaments }, memberships] = await Promise.all([
    getDiscoverData(today),
    getMemberships(),
  ])

  const isStudent = hasStudentAccess(memberships)
  const position = parsePosition(searchParams.lat, searchParams.lng)
  const cities = cityFacets(arenas)
  // Cidade inventada na URL não pode esvaziar a página sem explicação.
  const city = cities.includes(searchParams.cidade ?? '') ? searchParams.cidade! : ''

  const filtered = city ? arenas.filter((a) => a.city === city) : arenas
  const ranked = rankArenas(filtered, position)

  // Com posição ou cidade, o destaque acompanha o recorte de arenas.
  const visibleOrgIds = new Set(ranked.map((a) => a.id))
  const highlighted = tournaments
    .filter((t) => visibleOrgIds.has(t.organization_id))
    .slice(0, MAX_TOURNAMENTS)

  const asBrowse = (t: (typeof tournaments)[number]): BrowseTournament => ({
    id: t.id,
    name: t.name,
    date: t.date,
    sport: t.sport,
    status: 'open',
    level: t.level as BrowseTournament['level'],
    category: t.category as BrowseTournament['category'],
    participant_type: t.participant_type,
    format: t.format as BrowseTournament['format'],
    cover_image_url: t.cover_image_url,
    entry_price_cents: t.entry_price_cents,
    max_players: t.max_players,
    occupiedCount: t.occupiedCount,
    waitlistCount: 0,
    isMine: false,
  })

  return (
    <div className="space-y-5 p-4 pb-24">
      {/* ── Cabeçalho ───────────────────────────────────────────────────── */}
      <Reveal step={0}>
        <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-30px_rgb(var(--brand-600)/0.95)]">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
          />
          <div aria-hidden className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl" />
          <div className="relative">
            <h1 className="text-2xl font-extrabold text-white">Explorar</h1>
            <p className="mt-1 text-sm font-medium text-white/85">
              {isStudent
                ? 'Torneios e day use em outras arenas.'
                : 'Ache uma arena perto de você e entre num torneio ou day use.'}
            </p>
            <div className="mt-4">
              <GeoButton active={position !== null} />
            </div>
          </div>
        </div>
      </Reveal>

      {/* ── Filtro por cidade ───────────────────────────────────────────────
          Alternativa para quem negou a localização (ou está no desktop). Some
          quando a posição já ordena a lista. */}
      {!position && cities.length > 1 && (
        <Reveal step={1}>
          <div className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2">
              <CityChip label="Todas" href="/explorar" active={!city} />
              {cities.map((c) => (
                <CityChip
                  key={c}
                  label={c}
                  href={`/explorar?cidade=${encodeURIComponent(c)}`}
                  active={city === c}
                />
              ))}
            </div>
          </div>
        </Reveal>
      )}

      {/* ── Torneios abertos ────────────────────────────────────────────── */}
      {highlighted.length > 0 && (
        <Reveal step={2} as="section">
          <SectionHeader title="Torneios abertos" />
          <div className="grid gap-3 sm:grid-cols-2">
            {highlighted.map((t, i) => (
              <div key={t.id}>
                <TournamentCard
                  tournament={asBrowse(t)}
                  // Rota pública: funciona para quem ainda não tem vínculo.
                  href={`/t/${t.id}`}
                  phase="open"
                  step={i}
                />
                <p className="mt-1 flex items-center gap-1 px-1 text-[11px] font-semibold text-slate-500">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {t.orgName}
                  {t.orgCity ? ` · ${t.orgCity}` : ''}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── Arenas ──────────────────────────────────────────────────────── */}
      <Reveal step={3} as="section">
        <SectionHeader title={position ? 'Arenas perto de você' : 'Arenas'} />
        {ranked.length === 0 ? (
          <EmptyState
            icon={Compass}
            title={city ? `Nenhuma arena em ${city}` : 'Nenhuma arena por aqui ainda'}
            description={
              city
                ? 'Tente outra cidade ou veja todas.'
                : 'As academias aparecem aqui quando escolhem se listar publicamente.'
            }
            ctaHref={city ? '/explorar' : undefined}
            ctaLabel={city ? 'Ver todas' : undefined}
          />
        ) : (
          <div className="space-y-2">
            {ranked.map((arena, i) => (
              <ArenaCard key={arena.id} arena={arena} step={i} />
            ))}
          </div>
        )}
      </Reveal>

      {/* ── Virar aluno ─────────────────────────────────────────────────────
          Só para quem ainda não é: para o aluno o card seria ruído. */}
      {!isStudent && (
        <Reveal step={4} as="section">
          <SectionHeader title="Já treina em alguma?" />
          <JoinByCodeCard />
        </Reveal>
      )}

      {isStudent && (
        <Reveal step={4}>
          <Link
            href="/torneios"
            className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-surface-card px-4 py-3 transition-colors hover:border-brand-600/50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
              <Trophy className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">Voltar para a sua arena</span>
              <span className="block text-xs text-slate-400">Torneios e day use da sua academia</span>
            </span>
          </Link>
        </Reveal>
      )}
    </div>
  )
}

function CityChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
        active
          ? 'bg-brand-600 text-white'
          : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-brand-600/50 hover:text-white',
      )}
    >
      {label}
    </Link>
  )
}
