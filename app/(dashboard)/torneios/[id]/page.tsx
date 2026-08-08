// app/(dashboard)/torneios/[id]/page.tsx
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { getTournamentPhotos } from '@/features/torneios/photoQueries'
import { PhotoGallery } from '@/features/torneios/PhotoGallery'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { RegisterButton } from './RegisterButton'
import { formatDate } from '@/lib/utils/dateHelpers'
import { FORMATS } from '@/lib/torneios/formats'
import type { Tournament, TournamentStatus, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho', open: 'Inscrições Abertas', in_progress: 'Em Andamento', finished: 'Encerrado',
}

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps { params: { id: string } }

export default async function TorneioDetailPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  if (!orgId) redirect('/login')

  // Tournament via cliente do usuário (valida visibilidade + org via RLS).
  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error || !tournament) notFound()
  if ((tournament as Tournament).status === 'draft') notFound()

  const t = tournament as Tournament

  // Verificar inscrição do aluno (RLS: própria entrada).
  const { count: regCount } = await supabase
    .from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', params.id)
    .eq('player_id', user.id)
  const isRegistered = (regCount ?? 0) > 0

  // Dados de exibição (nomes dos participantes) via admin client: a RLS de `profiles`
  // impede o aluno de ler o perfil dos outros participantes, o que fazia a UI mostrar
  // o ID em vez do nome. O torneio já foi validado como pertencente à org do aluno,
  // então ler suas entradas/confrontos por tournament_id é seguro (sem vazar entre orgs).
  const adminClient = createAdminClient()

  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`player_id, partner_id, entry_status,
      player:profiles!tournament_entries_player_id_fkey(id, full_name),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)

  type EntryRow = {
    player_id: string; partner_id: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by, played_at,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })
    .order('match_no', { ascending: true })

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    player1_id: string | null; player2_id: string | null; partner1_id: string | null; partner2_id: string | null
    games1: number | null; games2: number | null; result_status: string | null
    reported_by: string | null; confirmed_by: string | null; played_at: string | null
    player1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    player2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner1: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner2: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const matches = ((matchesRaw ?? []) as unknown as ScoreMatchRaw[]).map((m) => ({
    ...m,
    player1: normalizeProf(m.player1),
    player2: normalizeProf(m.player2),
    partner1: normalizeProf(m.partner1),
    partner2: normalizeProf(m.partner2),
  }))

  // Confrontos do aluno logado
  const myMatches = matches.filter((m) =>
    m.player1_id === user.id || m.player2_id === user.id ||
    m.partner1_id === user.id || m.partner2_id === user.id
  )

  // Classificação (apenas inscritos confirmados)
  const entryRefs = entries
    .filter((e) => e.entry_status === 'confirmed')
    .map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: t.sets_to_win ?? 1,
    games_per_set: t.games_per_set ?? 6,
    tiebreak_games: t.tiebreak_games ?? true,
  }
  const fmt = FORMATS[t.format ?? 'americano']
  const standings = fmt ? fmt.computeStandings(entryRefs, matches as unknown as MatchResultInput[], scoring) : []

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }

  // Parceiros disponíveis para dupla_fixa (admin client: RLS bloqueia leitura de
  // memberships/profiles de outros alunos).
  const needsPartner = t.participant_type === 'dupla_fixa'
  let potentialPartners: { id: string; full_name: string }[] = []
  if (needsPartner && t.status === 'open') {
    const { data: membRaw } = await adminClient
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey(full_name)')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .neq('user_id', user.id)
    type MembRow = { user_id: string; profiles: { full_name: string } | { full_name: string }[] | null }
    potentialPartners = ((membRaw ?? []) as unknown as MembRow[]).map((m) => {
      const prof = normalizeProf(m.profiles as { full_name: string } | { full_name: string }[])
      return { id: m.user_id, full_name: prof?.full_name ?? '' }
    }).filter((p) => p.full_name)
  }

  const chips = [
    formatDate(t.date, "dd 'de' MMMM 'de' yyyy"),
    STATUS_LABELS[t.status],
    t.category ? t.category.charAt(0).toUpperCase() + t.category.slice(1) : null,
  ].filter(Boolean) as string[]

  const photos = await getTournamentPhotos(orgId, params.id)

  return (
    <div className="p-4 space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5">
        <Link
          href="/torneios"
          className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          aria-label="Voltar"
        >
          ←
        </Link>
        <h1 className="text-2xl font-bold leading-tight text-white">{t.name}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Inscrição */}
      {t.status === 'open' && (
        <Card accent={!isRegistered}>
          {isRegistered ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">Inscrito</Badge>
              <span className="text-sm text-slate-400">Você já está inscrito neste torneio.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">Inscrições abertas. Participe!</p>
              <RegisterButton
                tournamentId={t.id}
                participantType={t.participant_type ?? 'dupla_revezando'}
                potentialPartners={potentialPartners}
              />
            </div>
          )}
        </Card>
      )}

      {/* Meus confrontos */}
      {myMatches.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <span className="text-brand-500">🎾</span> Meus confrontos
          </h2>
          <div className="space-y-3">
            {myMatches.map((match) => (
              <MatchScoreCard
                key={match.id}
                match={{
                  ...match,
                  player1_id: match.player1_id ?? '',
                  player2_id: match.player2_id ?? '',
                  result_status: match.result_status as 'pending' | 'confirmed' | null,
                  played_at: match.played_at,
                }}
                currentUserId={user.id}
                isAdmin={false}
                roundLabel={`Rodada ${match.round}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Classificação */}
      {standings.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
            <span className="text-brand-500">🏆</span> Classificação
          </h2>
          <StandingsTable rows={standings} nameById={nameById} highlightId={user.id} />
        </section>
      )}

      {/* Todos os confrontos */}
      {matches.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-white">Todos os confrontos</h2>
          <div className="space-y-6">
            {Array.from(
              matches.reduce((acc, m) => {
                acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                return acc
              }, new Map<number, typeof matches>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([round, roundMatches]) => (
                <div key={round}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Rodada {round}</h3>
                  <div className="space-y-2">
                    {roundMatches.map((match) => (
                      <MatchScoreCard
                        key={match.id}
                        match={{
                          ...match,
                          player1_id: match.player1_id ?? '',
                          player2_id: match.player2_id ?? '',
                          result_status: match.result_status as 'pending' | 'confirmed' | null,
                          played_at: match.played_at,
                        }}
                        currentUserId={user.id}
                        isAdmin={false}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      <PhotoGallery photos={photos} title="MURAL DO TORNEIO" />
    </div>
  )
}
