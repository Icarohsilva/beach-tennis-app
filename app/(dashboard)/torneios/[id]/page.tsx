// app/(dashboard)/torneios/[id]/page.tsx
// A página do torneio pelo lado do aluno.
//
// Ordem de leitura pensada para quem abre no meio do evento: onde eu jogo
// agora, quem está ganhando, como está a chave, e só então a lista completa de
// confrontos. Com o torneio em andamento a página se atualiza sozinha
// (LiveRefresher), então quem está na arquibancada vê o placar mudar.
import { notFound, redirect } from 'next/navigation'
import { CalendarClock, LayoutGrid, ListOrdered, Swords, Trophy } from 'lucide-react'
import { createClient, createAdminClient, getActiveOrgId, getAuthUser } from '@/lib/supabase/server'
import { getTournamentPhotos } from '@/features/torneios/photoQueries'
import { PhotoGallery } from '@/features/torneios/PhotoGallery'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Reveal } from '@/components/ui/Reveal'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { TournamentHero } from '@/features/torneios/TournamentHero'
import { BracketView } from '@/features/torneios/BracketView'
import { PodiumCard, type PodiumPlace } from '@/features/torneios/PodiumCard'
import { LiveRefresher } from '@/features/torneios/LiveRefresher'
import { ShareButton } from '@/features/torneios/ShareButton'
import { RegisterButton } from './RegisterButton'
import {
  DEFAULT_ADVANCE_PER_GROUP,
  DEFAULT_GROUP_COUNT,
  FORMATS,
  hasGroupStage,
  isBracketFormat,
} from '@/lib/torneios/formats'
import { computeGroupTables, splitPhases } from '@/lib/torneios/schedule/grupos'
import { GroupTables } from '@/features/torneios/GroupTables'
import { ParticipantModalProvider } from '@/features/torneios/ParticipantModal'
import { roundLabel as bracketRoundLabel } from '@/lib/torneios/bracket'
import { buildBracketColumns } from '@/lib/torneios/bracketView'
import { competitorNoun } from '@/lib/torneios/sportProfile'
import { teamLabel } from '@/lib/torneios/display'
import type { Tournament, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps {
  params: { id: string }
}

export default async function TorneioDetailPage({ params }: PageProps) {
  const supabase = createClient()
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  if (!orgId) redirect('/login')

  // Torneio via cliente do usuário (valida visibilidade + org via RLS).
  const { data: tournament, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()

  if (error || !tournament) notFound()
  const t = tournament as Tournament
  if (t.status === 'draft') notFound()

  // Dados de exibição via admin client: a RLS de `profiles` impede o aluno de
  // ler o perfil dos outros participantes, o que fazia a UI mostrar o ID em vez
  // do nome. O torneio já foi validado como da org do aluno, então ler suas
  // entradas/confrontos por tournament_id é seguro (não vaza entre orgs).
  const adminClient = createAdminClient()

  const [{ data: entriesRaw }, { data: matchesRaw }, photos] = await Promise.all([
    adminClient
      .from('tournament_entries')
      .select(`player_id, partner_id, entry_status,
        player:profiles!tournament_entries_player_id_fkey(id, full_name),
        partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
      .eq('tournament_id', params.id),
    adminClient
      .from('tournament_matches')
      .select(`id, tournament_id, round, match_no, group_label,
        player1_id, player2_id, partner1_id, partner2_id,
        games1, games2, result_status, reported_by, confirmed_by, played_at,
        player1:profiles!player1_id(id, full_name),
        player2:profiles!player2_id(id, full_name),
        partner1:profiles!partner1_id(id, full_name),
        partner2:profiles!partner2_id(id, full_name)`)
      .eq('tournament_id', params.id)
      .order('round', { ascending: true })
      .order('match_no', { ascending: true }),
    getTournamentPhotos(orgId, params.id),
  ])

  type EntryRow = {
    player_id: string
    partner_id: string | null
    entry_status: 'confirmed' | 'waitlist' | 'offered'
    player: { id: string; full_name: string } | { id: string; full_name: string }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  type ScoreMatchRaw = {
    id: string; tournament_id: string; round: number; match_no: number | null
    group_label: string | null
    player1_id: string | null; player2_id: string | null
    partner1_id: string | null; partner2_id: string | null
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

  const nameById: Record<string, string> = {}
  for (const e of entries) {
    const p = normalizeProf(e.player)
    if (p) nameById[p.id] = p.full_name
    const pt = normalizeProf(e.partner)
    if (pt) nameById[pt.id] = pt.full_name
  }

  const isMine = entries.some((e) => e.player_id === user.id || e.partner_id === user.id)
  // Mesma contagem de availableSlots: 'offered' já ocupa vaga.
  const occupiedCount = entries.filter((e) => e.entry_status !== 'waitlist').length
  const waitlistCount = entries.filter((e) => e.entry_status === 'waitlist').length

  // Confrontos do aluno logado, com o próximo sem resultado em destaque.
  const myMatches = matches.filter(
    (m) =>
      m.player1_id === user.id || m.player2_id === user.id ||
      m.partner1_id === user.id || m.partner2_id === user.id,
  )
  const myNextMatch = myMatches.find((m) => m.result_status !== 'confirmed') ?? null

  // Classificação (apenas inscritos confirmados).
  const entryRefs = entries
    .filter((e) => e.entry_status === 'confirmed')
    .map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
  const scoring: ScoringConfig = {
    sets_to_win: t.sets_to_win ?? 1,
    games_per_set: t.games_per_set ?? 6,
    tiebreak_games: t.tiebreak_games ?? true,
  }
  // O select devolve result_status e group_label como text; as constraints das
  // migrações 20260626000700/20260809000300 garantem os valores possíveis.
  const normalized = matches.map((m) => ({
    ...m,
    result_status: m.result_status as 'pending' | 'confirmed' | null,
    group: m.group_label,
  }))

  const engine = FORMATS[t.format ?? 'americano']
  const standings = engine
    ? engine.computeStandings(entryRefs, normalized as unknown as MatchResultInput[], scoring)
    : []

  // As duas fases moram na mesma tabela; o mata-mata volta a contar rodadas do
  // 1 para a chave saber que a última é a final e não a "quinta fase".
  const { groupMatches, knockoutMatches, groupRounds } = splitPhases(normalized)
  const isBracket = isBracketFormat(t.format)
  const withGroups = hasGroupStage(t.format)
  const bracketColumns = isBracket
    ? buildBracketColumns(knockoutMatches, nameById, user.id)
    : []
  const knockoutRounds = knockoutMatches.length > 0 ? Math.max(...knockoutMatches.map((m) => m.round)) : 0

  const groupCount = t.group_count ?? DEFAULT_GROUP_COUNT
  const advancePerGroup = t.advance_per_group ?? DEFAULT_ADVANCE_PER_GROUP
  const groupTables =
    withGroups && groupMatches.length > 0
      ? computeGroupTables(entryRefs, normalized as unknown as MatchResultInput[], groupCount, scoring)
      : []

  // Pódio: sai dos vencedores gravados no fechamento; sem eles, do topo da
  // classificação. O torneio encerrado congela o pódio em `winnerN_id`, então
  // ele é a fonte de verdade quando existe.
  const podium: PodiumPlace[] =
    t.status === 'finished'
      ? ([
          [1, t.winner1_id, t.winner1_partner_id],
          [2, t.winner2_id, t.winner2_partner_id],
          [3, t.winner3_id, t.winner3_partner_id],
        ] as const)
          .filter(([, id]) => !!id)
          .map(([position, id, partnerId]) => ({
            position: position as 1 | 2 | 3,
            label: teamLabel([nameById[id as string], partnerId ? nameById[partnerId] : null]),
            ids: [id as string, partnerId].filter((x): x is string => !!x),
          }))
      : []

  // Parceiros disponíveis para dupla_fixa (admin client: RLS bloqueia leitura de
  // memberships/profiles de outros alunos).
  const needsPartner = t.participant_type === 'dupla_fixa'
  let potentialPartners: { id: string; full_name: string }[] = []
  if (needsPartner && t.status === 'open' && !isMine) {
    const { data: membRaw } = await adminClient
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey(full_name)')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .neq('user_id', user.id)
    type MembRow = { user_id: string; profiles: { full_name: string } | { full_name: string }[] | null }
    potentialPartners = ((membRaw ?? []) as unknown as MembRow[])
      .map((m) => {
        const prof = normalizeProf(m.profiles as { full_name: string } | { full_name: string }[])
        return { id: m.user_id, full_name: prof?.full_name ?? '' }
      })
      .filter((p) => p.full_name)
  }

  const roundsOfMatches = Array.from(
    matches.reduce((acc, m) => {
      acc.set(m.round, [...(acc.get(m.round) ?? []), m])
      return acc
    }, new Map<number, typeof matches>()),
  ).sort(([a], [b]) => a - b)

  /**
   * Nome da rodada na lista de confrontos.
   *
   * Na fase de grupos é só o número. No mata-mata é a FASE, e ela se conta a
   * partir de onde os grupos pararam: sem descontar o deslocamento, a final de
   * um torneio com 3 rodadas de grupo seria anunciada como "4ª rodada".
   */
  const labelForRound = (round: number, group: string | null) => {
    if (group) return `Rodada ${round}`
    if (!isBracket || knockoutRounds === 0) return `Rodada ${round}`
    return bracketRoundLabel(round - groupRounds, knockoutRounds)
  }

  const toScoreMatch = (m: (typeof matches)[number]) => ({
    ...m,
    player1_id: m.player1_id ?? '',
    player2_id: m.player2_id ?? '',
    result_status: m.result_status as 'pending' | 'confirmed' | null,
    played_at: m.played_at,
  })

  return (
    // O provider guarda UM modal para a página inteira; as tabelas só pedem
    // para abri-lo pelo id do inscrito.
    <ParticipantModalProvider tournamentId={t.id}>
    <div className="space-y-5 p-4 pb-24">
      <Reveal step={0}>
        <TournamentHero
          tournament={t}
          occupiedCount={occupiedCount}
          waitlistCount={waitlistCount}
          actions={
            <>
              <LiveRefresher tournamentId={t.id} enabled={t.status === 'in_progress'} />
              <ShareButton path={`/t/${t.id}`} title={t.name} />
            </>
          }
        />
      </Reveal>

      {/* ── Inscrição ───────────────────────────────────────────────────── */}
      {t.status === 'open' && (
        <Reveal step={1}>
          <Card accent={!isMine}>
            {isMine ? (
              <div className="flex items-center gap-2">
                <Badge variant="success">Inscrito</Badge>
                <span className="text-sm text-slate-400">
                  Você está dentro. A chave sai quando as inscrições fecharem.
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-slate-300">
                  Inscrições abertas
                  {t.max_players
                    ? ` · ${Math.max(0, t.max_players - occupiedCount)} ${competitorNoun(t.sport, t.participant_type, true)} ainda cabem.`
                    : '.'}
                </p>
                <RegisterButton
                  tournamentId={t.id}
                  participantType={t.participant_type ?? 'dupla_revezando'}
                  potentialPartners={potentialPartners}
                />
              </div>
            )}
          </Card>
        </Reveal>
      )}

      {/* ── Pódio ───────────────────────────────────────────────────────── */}
      {podium.length > 0 && (
        <Reveal step={2} as="section">
          <SectionTitle icon={Trophy}>Pódio</SectionTitle>
          <PodiumCard places={podium} currentUserId={user.id} />
        </Reveal>
      )}

      {/* ── Meu próximo jogo ────────────────────────────────────────────── */}
      {myNextMatch && (
        <Reveal step={2} as="section">
          <SectionTitle icon={CalendarClock}>Seu próximo jogo</SectionTitle>
          <MatchScoreCard
            match={toScoreMatch(myNextMatch)}
            currentUserId={user.id}
            isAdmin={false}
            roundLabel={labelForRound(myNextMatch.round, myNextMatch.group_label)}
          />
        </Reveal>
      )}

      {/* ── Fase de grupos ──────────────────────────────────────────────── */}
      {groupTables.length > 0 && (
        <Reveal step={3} as="section">
          <SectionTitle icon={LayoutGrid}>Fase de grupos</SectionTitle>
          <GroupTables
            tables={groupTables}
            nameById={nameById}
            advancePerGroup={advancePerGroup}
            currentUserId={user.id}
            settled={knockoutMatches.length > 0}
          />
        </Reveal>
      )}

      {/* ── Chave ───────────────────────────────────────────────────────── */}
      {bracketColumns.length > 0 && (
        <Reveal step={3} as="section">
          <SectionTitle icon={Swords}>{withGroups ? 'Mata-mata' : 'Chave'}</SectionTitle>
          <BracketView columns={bracketColumns} />
        </Reveal>
      )}

      {/* ── Classificação ───────────────────────────────────────────────── */}
      {standings.length > 0 && (
        <Reveal step={4} as="section">
          <SectionTitle icon={ListOrdered}>Classificação</SectionTitle>
          <StandingsTable
            rows={standings}
            nameById={nameById}
            highlightId={user.id}
            linkToProfile
          />
        </Reveal>
      )}

      {/* ── Todos os confrontos ─────────────────────────────────────────── */}
      {matches.length > 0 && (
        <Reveal step={5} as="section">
          <SectionTitle icon={Swords}>Todos os confrontos</SectionTitle>
          <div className="space-y-5">
            {roundsOfMatches.map(([round, roundMatches]) => (
              <div key={round}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                  {labelForRound(round, roundMatches[0]?.group_label ?? null)}
                </h3>
                <div className="space-y-2">
                  {roundMatches.map((match) => (
                    <MatchScoreCard
                      key={match.id}
                      match={toScoreMatch(match)}
                      currentUserId={user.id}
                      isAdmin={false}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      )}

      <Reveal step={6}>
        <PhotoGallery photos={photos} title="MURAL DO TORNEIO" />
      </Reveal>
    </div>
    </ParticipantModalProvider>
  )
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Trophy
  children: React.ReactNode
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-white">
      <Icon className="h-4 w-4 text-brand-500" aria-hidden />
      {children}
    </h2>
  )
}
