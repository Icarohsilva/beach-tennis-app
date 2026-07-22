// app/(dashboard)/torneios/page.tsx
// Aba "Arena": reúne o Day Use (quadra avulsa) e os Torneios da academia.
// Substituiu a antiga aba "Aulas" — a agenda de aulas passou para a Home.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Sun, Trophy, ArrowRight } from 'lucide-react'
import { createClient, getActiveOrgId } from '@/lib/supabase/server'
import { TournamentCard } from '@/features/torneios/TournamentCard'
import { NextMatchCard } from '@/features/torneios/NextMatchCard'
import { getStudentTournamentHome } from '@/features/torneios/studentHome'
import { Reveal } from '@/components/ui/Reveal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { Tournament, DayUseSlot } from '@/types'

const LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os níveis' },
  { value: 'iniciante', label: 'Iniciante' },
  { value: 'D', label: 'Nível D' },
  { value: 'C', label: 'Nível C' },
  { value: 'B', label: 'Nível B' },
  { value: 'A', label: 'Nível A' },
]

interface PageProps {
  searchParams: { nivel?: string }
}

export default async function ArenaPage({ searchParams }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  const nivel = searchParams.nivel ?? ''
  const today = new Date().toISOString().slice(0, 10)

  let tournamentQuery = supabase
    .from('tournaments')
    .select('*')
    .eq('organization_id', orgId)
    .neq('status', 'draft')
    .order('date', { ascending: true })
  if (nivel) tournamentQuery = tournamentQuery.eq('level', nivel)

  const [{ data: tournamentsData }, { data: dayUseData }, tournamentHome] = await Promise.all([
    tournamentQuery,
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

  const tournaments = (tournamentsData ?? []) as Tournament[]
  const dayUseSlots = (dayUseData ?? []) as Pick<
    DayUseSlot,
    'id' | 'court' | 'date' | 'start_time' | 'end_time' | 'capacity' | 'notes'
  >[]
  const { myTournaments, myTournamentIds, nextMatch } = tournamentHome
  const otherTournaments = tournaments.filter((t) => !myTournamentIds.has(t.id))

  return (
    <div className="space-y-6 p-4 pb-24">
      {/* Cabeçalho de marca da aba */}
      <Reveal step={0}>
        <div className="sheen relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500 via-brand-700 to-brand-900 p-5 shadow-[0_24px_60px_-30px_rgb(var(--brand-600)/0.95)]">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgb(255_255_255/0.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.5)_1px,transparent_1px)] [background-size:26px_26px]"
          />
          <div
            aria-hidden
            className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-white/20 blur-3xl"
          />
          <div className="relative">
            <h1 className="text-2xl font-extrabold text-white">Arena</h1>
            <p className="mt-1 text-sm font-medium text-white/85">
              Torneios da sua academia e quadra avulsa (Day Use).
            </p>
          </div>
        </div>
      </Reveal>

      {/* ── Day Use ─────────────────────────────────────────────────────────── */}
      <Reveal step={1} as="section">
        <SectionHeader title="Day Use" href="/agendar/dayuse" linkLabel="reservar" />
        {dayUseSlots.length === 0 ? (
          <EmptyState
            icon={Sun}
            title="Nenhum horário disponível"
            description="O professor divulga os horários de day use com antecedência."
          />
        ) : (
          <div className="space-y-2">
            {dayUseSlots.map((slot) => (
              <Link key={slot.id} href="/agendar/dayuse" className="group block">
                <Card glass interactive>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300">
                        <Sun className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDate(slot.date, "EEE, dd 'de' MMM")}
                          {slot.notes ? ` · ${slot.notes}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full border border-sky-700/50 bg-sky-900/40 px-2 py-0.5 text-xs text-sky-300">
                        Espaço {slot.court}
                      </span>
                      <ArrowRight className="h-4 w-4 text-slate-400 transition-colors group-hover:text-brand-400" />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Reveal>

      {/* ── Próximo confronto do aluno ──────────────────────────────────────── */}
      {nextMatch && (
        <Reveal step={2}>
          <NextMatchCard match={nextMatch} />
        </Reveal>
      )}

      {/* ── Meus torneios ───────────────────────────────────────────────────── */}
      {myTournaments.length > 0 && (
        <Reveal step={2} as="section">
          <SectionHeader title="Meus torneios" />
          <div className="space-y-2">
            {myTournaments.map((t) => (
              <Link key={t.id} href={`/torneios/${t.id}`} className="group block">
                <Card glass accent interactive>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
                        <Trophy className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{t.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDate(t.date, "dd 'de' MMMM")}
                        </p>
                      </div>
                    </div>
                    <Badge variant={t.status === 'in_progress' ? 'warning' : 'success'}>
                      {t.status === 'in_progress' ? 'Em andamento' : 'Inscrito'}
                    </Badge>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </Reveal>
      )}

      {/* ── Torneios da academia ────────────────────────────────────────────── */}
      <Reveal step={3} as="section">
        <SectionHeader title="Torneios" />

        <div className="mb-3 flex flex-wrap gap-2">
          {LEVEL_OPTIONS.map((opt) => {
            const isActive = nivel === opt.value
            const href = opt.value ? `/torneios?nivel=${opt.value}` : '/torneios'
            return (
              <Link
                key={opt.value}
                href={href}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:border-brand-600/50 hover:text-white'
                }`}
              >
                {opt.label}
              </Link>
            )
          })}
        </div>

        {otherTournaments.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {myTournaments.length > 0
              ? 'Nenhum outro torneio disponível no momento.'
              : 'Nenhum torneio disponível no momento.'}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {otherTournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                href={`/torneios/${tournament.id}`}
              />
            ))}
          </div>
        )}
      </Reveal>
    </div>
  )
}
