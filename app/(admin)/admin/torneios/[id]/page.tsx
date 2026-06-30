// app/(admin)/admin/torneios/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { MatchScoreCard } from '@/features/torneios/MatchScoreCard'
import { StandingsTable } from '@/features/torneios/StandingsTable'
import { GenerateBracketButton } from './GenerateBracketButton'
import { CoverImageCard } from './CoverImageCard'
import { CloseTournamentButton } from './CloseTournamentButton'
import { WinnersCard } from './WinnersCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import { FORMATS } from '@/lib/torneios/formats'
import type { Tournament, TournamentStatus, ScoringConfig } from '@/types'
import type { MatchResultInput } from '@/lib/torneios/types'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}
const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default', open: 'success', in_progress: 'warning', finished: 'danger',
}

function normalizeProf<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

interface PageProps { params: { id: string } }

export default async function AdminTorneioDetailPage({ params }: PageProps) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  if (!orgId) notFound()

  const { data: tournament, error } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .eq('organization_id', orgId)
    .single()
  if (error || !tournament) notFound()

  const t = tournament as Tournament

  // Entradas (tournament_entries) com nome do jogador
  const { data: entriesRaw } = await adminClient
    .from('tournament_entries')
    .select(`id, player_id, partner_id, seed, created_at,
      player:profiles!tournament_entries_player_id_fkey(id, full_name, gender),
      partner:profiles!tournament_entries_partner_id_fkey(id, full_name)`)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  type EntryRow = {
    id: string; player_id: string; partner_id: string | null; seed: number | null; created_at: string
    player: { id: string; full_name: string; gender: string | null } | { id: string; full_name: string; gender: string | null }[] | null
    partner: { id: string; full_name: string } | { id: string; full_name: string }[] | null
  }
  const entries = (entriesRaw ?? []) as unknown as EntryRow[]

  // Nível por-academia (membership desta org)
  const playerIds = entries.map((e) => e.player_id)
  const { data: levelMemsRaw } = playerIds.length > 0
    ? await adminClient.from('memberships').select('user_id, level').in('user_id', playerIds).eq('organization_id', orgId)
    : { data: [] }
  const levelByPlayer = new Map<string, string>()
  for (const m of (levelMemsRaw ?? []) as { user_id: string; level: string }[]) {
    levelByPlayer.set(m.user_id, m.level)
  }

  // Confrontos com colunas de placar/status
  const { data: matchesRaw } = await adminClient
    .from('tournament_matches')
    .select(`id, tournament_id, round, match_no,
      player1_id, player2_id, partner1_id, partner2_id,
      games1, games2, result_status, reported_by, confirmed_by,
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
    reported_by: string | null; confirmed_by: string | null
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

  // Classificação computada no servidor pelo formato
  const entryRefs = entries.map((e) => ({ playerId: e.player_id, partnerId: e.partner_id ?? null }))
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

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arenahub.website'
  const shareUrl = `${baseUrl}/t/${t.id}`
  const isFinished = t.status === 'finished'

  // Lista de jogadores para o WinnersCard
  const allPlayers = entries
    .map((e) => normalizeProf(e.player))
    .filter(Boolean)
    .map((p) => p as { id: string; full_name: string })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/torneios" className="text-slate-400 hover:text-white transition-colors mt-1">←</Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{t.name}</h1>
            <Badge variant={STATUS_VARIANTS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")} · Nível {t.level.toUpperCase()}
            {t.sport && ` · ${t.sport}`}
            {t.format && ` · ${t.format}`}
            {t.category && ` · ${t.category}`}
          </p>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="grid gap-3 sm:grid-cols-2">
        <CoverImageCard
          tournamentId={t.id}
          coverImageUrl={t.cover_image_url ?? null}
          shareUrl={shareUrl}
        />
        <div className="space-y-3">
          <Card>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Ações</p>
            <div className="flex flex-wrap gap-2">
              {t.status === 'open' && <GenerateBracketButton tournamentId={t.id} />}
              {t.status !== 'finished' && (
                <CloseTournamentButton tournamentId={t.id} />
              )}
            </div>
          </Card>
          <WinnersCard
            tournamentId={t.id}
            isFinished={isFinished}
            winner1Id={t.winner1_id ?? null}
            winner2Id={t.winner2_id ?? null}
            winner3Id={t.winner3_id ?? null}
            allPlayers={allPlayers}
          />
        </div>
      </div>

      {/* Inscrições */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Inscrições ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhuma inscrição ainda.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map((entry) => {
              const p = normalizeProf(entry.player)
              const pt = normalizeProf(entry.partner)
              const lvl = levelByPlayer.get(entry.player_id)
              return (
                <Card key={entry.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-white font-medium">{p?.full_name ?? entry.player_id}</p>
                      {pt && <p className="text-xs text-slate-400">Parceiro: {pt.full_name}</p>}
                    </div>
                    {lvl && <Badge variant="level">{lvl.toUpperCase()}</Badge>}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Classificação */}
      {standings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Classificação</h2>
          <StandingsTable rows={standings} nameById={nameById} />
        </section>
      )}

      {/* Confrontos */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Confrontos</h2>
        {matches.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhum confronto gerado ainda.</p>
        ) : (
          <div className="space-y-8">
            {Array.from(
              matches.reduce((acc, m) => {
                acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                return acc
              }, new Map<number, typeof matches>()),
            )
              .sort(([a], [b]) => a - b)
              .map(([round, roundMatches]) => (
                <div key={round}>
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Rodada {round}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {roundMatches.map((match) => (
                      <MatchScoreCard
                        key={match.id}
                        match={{
                          ...match,
                          player1_id: match.player1_id ?? '',
                          player2_id: match.player2_id ?? '',
                          result_status: match.result_status as 'pending' | 'confirmed' | null,
                        }}
                        isAdmin
                        currentUserId=""
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}
