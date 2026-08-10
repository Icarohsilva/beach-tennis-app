// app/(dashboard)/torneios/page.tsx
// Aba "Arena": os torneios da academia e o Day Use (quadra avulsa).
//
// A vitrine é multimodalidade: as abas de esporte nascem do que a academia
// realmente publicou, e o vocabulário de cada card (dupla/atleta/time, escala de
// nível, nome do formato) sai de lib/torneios/sportProfile. Filtro, busca e
// ordem moram na URL e são resolvidos no servidor por lib/torneios/browse — a
// página só desenha.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Sun, Trophy, SearchX } from 'lucide-react'
import { createClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import { TournamentFilters } from '@/features/torneios/TournamentFilters'
import { ArenaHero } from '@/features/torneios/ArenaHero'
import { NextMatchCard } from '@/features/torneios/NextMatchCard'
import { getStudentTournamentHome } from '@/features/torneios/studentHome'
import { getTournamentBrowse } from '@/features/torneios/browseQueries'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import {
  filterTournaments,
  groupByPhase,
  levelFacets,
  phaseCounts,
  sportFacets,
  summarize,
  type Phase,
} from '@/lib/torneios/browse'
import type { DayUseSlot } from '@/types'
import { brtToday } from '@/lib/utils/gridSchedule'

const PHASE_TITLES: Record<Phase, string> = {
  live: 'Acontecendo agora',
  open: 'Inscrições abertas',
  past: 'Já aconteceram',
}

interface PageProps {
  // `nivel` mantém o nome que a lista antiga já usava, então link salvo continua
  // abrindo o mesmo recorte.
  searchParams: {
    busca?: string
    esporte?: string
    nivel?: string
    quando?: string
  }
}

export default async function ArenaPage({ searchParams }: PageProps) {
  const supabase = createClient()
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  // BRT: com o UTC cru, o day use de hoje sumia da grade depois das 21h.
  const today = brtToday(new Date())

  const [browse, dayUseResult, tournamentHome] = await Promise.all([
    getTournamentBrowse({ orgId, userId: user.id }),
    supabase
      .from('dayuse_slots')
      .select('id, court, date, start_time, end_time, capacity, notes')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .gte('date', today)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(6),
    getStudentTournamentHome({ orgId, userId: user.id }),
  ])

  const dayUseSlots = (dayUseResult.data ?? []) as Pick<
    DayUseSlot,
    'id' | 'court' | 'date' | 'start_time' | 'end_time' | 'capacity' | 'notes'
  >[]
  const { tournaments, championById } = browse
  const { nextMatch } = tournamentHome

  // Filtros vindos da URL. `esporte` só vale se a academia tiver torneio nele —
  // link velho ou parâmetro inventado não pode esvaziar a página sem explicação.
  const sports = sportFacets(tournaments)
  const sport = sports.some((s) => s.value === searchParams.esporte) ? searchParams.esporte! : ''
  const q = (searchParams.busca ?? '').slice(0, 80)
  const level = searchParams.nivel ?? ''
  const phase = searchParams.quando ?? ''

  // As facetas de nível seguem o esporte aberto: dentro de uma modalidade os
  // níveis mudam de nome (e de existência).
  const inSport = sport ? tournaments.filter((t) => t.sport === sport) : tournaments
  const levels = levelFacets(inSport, sport || undefined)
  const counts = phaseCounts(inSport, today)

  const visible = filterTournaments(tournaments, { q, sport, level, phase }, today)
  const sections = groupByPhase(visible, today)
  const summary = summarize(tournaments, today)

  const hasFilter = !!(q || sport || level || (phase && phase !== 'todos'))
  const sportsLabel =
    sports.length > 0 && sports.length <= 3
      ? sports.map((s) => s.label).join(', ')
      : sports.length > 3
        ? `${sports.length} modalidades`
        : null

  const phaseOptions = [
    { key: 'todos' as const, label: 'Todos', count: counts.todos },
    ...(counts.live > 0 ? [{ key: 'live' as const, label: 'Ao vivo', count: counts.live }] : []),
    { key: 'open' as const, label: 'Abertos', count: counts.open },
    ...(counts.meus > 0 ? [{ key: 'meus' as const, label: 'Meus', count: counts.meus }] : []),
    ...(counts.past > 0 ? [{ key: 'past' as const, label: 'Encerrados', count: counts.past }] : []),
  ]

  // A cascata de entrada é contínua entre as seções: o card 3 da segunda seção
  // continua de onde a primeira parou, em vez de reiniciar o atraso.
  let cardStep = 0

  return (
    <div className="space-y-5 p-4 pb-24">
      <Reveal step={0}>
        <ArenaHero
          summary={summary}
          sportsLabel={sportsLabel}
          playerId={user.id}
          // Só oferece o retrospecto para quem já entrou em algum torneio;
          // numa conta nova a página abriria vazia.
          hasHistory={tournaments.some((t) => t.isMine)}
        />
      </Reveal>

      {nextMatch && (
        <Reveal step={1}>
          <NextMatchCard match={nextMatch} />
        </Reveal>
      )}

      {/* ── Day Use ─────────────────────────────────────────────────────────
          Faixa horizontal: antes era uma pilha de até seis cards que empurrava
          os torneios para fora da primeira tela. */}
      <Reveal step={2} as="section">
        <SectionHeader title="Day Use" href="/agendar/dayuse" linkLabel="reservar" />
        {dayUseSlots.length === 0 ? (
          <EmptyState
            icon={Sun}
            title="Nenhum horário disponível"
            description="O professor divulga os horários de day use com antecedência."
          />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex w-max gap-2">
              {dayUseSlots.map((slot) => (
                <li key={slot.id} className="w-[190px] shrink-0">
                  <Link href="/agendar/dayuse" className="group block h-full">
                    <Card glass interactive className="h-full">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                        <Sun className="h-4 w-4" />
                      </span>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-400 first-letter:uppercase">
                        {formatDate(slot.date, "EEE, dd 'de' MMM")}
                      </p>
                      <p className="mt-1.5 inline-flex rounded-full border border-sky-700/50 bg-sky-900/40 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                        Espaço {slot.court}
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Reveal>

      {/* ── Torneios ────────────────────────────────────────────────────── */}
      <Reveal step={3} as="section" className="space-y-4">
        <SectionHeader title="Torneios" />

        {tournaments.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Nenhum torneio por aqui ainda"
            description="Quando a academia abrir um torneio, ele aparece nesta aba com as vagas em tempo real."
          />
        ) : (
          <>
            <TournamentFilters
              sports={sports}
              levels={levels}
              phases={phaseOptions}
              active={{ q, sport, level, phase }}
            />

            {sections.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title="Nada encontrado com esses filtros"
                description={
                  hasFilter
                    ? 'Tente outra modalidade, outro nível ou limpe a busca.'
                    : 'Nenhum torneio disponível no momento.'
                }
                ctaHref="/torneios"
                ctaLabel="Limpar filtros"
              />
            ) : (
              <div className="space-y-6">
                {sections.map((section) => (
                  <div key={section.phase}>
                    <h3 className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {section.phase === 'live' && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                        </span>
                      )}
                      {PHASE_TITLES[section.phase]}
                      <span className="text-slate-600">{section.items.length}</span>
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {section.items.map((t) => (
                        <TournamentCard
                          key={t.id}
                          tournament={t}
                          href={`/torneios/${t.id}`}
                          phase={section.phase}
                          champion={championById[t.id]}
                          step={cardStep++}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Reveal>
    </div>
  )
}
