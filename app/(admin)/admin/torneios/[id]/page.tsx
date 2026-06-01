// app/(admin)/torneios/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { BracketView } from '@/features/torneios/BracketView'
import { AdminMatchCard } from './AdminMatchCard'
import { formatDate } from '@/lib/utils/dateHelpers'
import type { Tournament, TournamentStatus } from '@/types'
import type { TournamentMatch } from '@/features/torneios/BracketView'

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Rascunho',
  open: 'Inscrições Abertas',
  in_progress: 'Em Andamento',
  finished: 'Encerrado',
}

const STATUS_VARIANTS: Record<TournamentStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'default',
  open: 'success',
  in_progress: 'warning',
  finished: 'danger',
}

interface PageProps {
  params: { id: string }
}

export default async function AdminTorneioDetailPage({ params }: PageProps) {
  const adminClient = createAdminClient()

  // Fetch tournament
  const { data: tournament, error } = await adminClient
    .from('tournaments')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !tournament) notFound()

  const t = tournament as Tournament

  // Fetch registrations with player names
  const { data: registrationsData } = await adminClient
    .from('tournament_registrations')
    .select(`
      id,
      player_id,
      partner_id,
      created_at,
      player:profiles!player_id(id, full_name, level),
      partner:profiles!partner_id(id, full_name)
    `)
    .eq('tournament_id', params.id)
    .order('created_at', { ascending: true })

  type Registration = {
    id: string
    player_id: string
    partner_id: string | null
    created_at: string
    player: { id: string; full_name: string; level: string } | null
    partner: { id: string; full_name: string } | null
  }
  const registrations = (registrationsData ?? []) as unknown as Registration[]

  // Fetch matches with player names
  const { data: matchesData } = await adminClient
    .from('tournament_matches')
    .select(`
      id, tournament_id, round, player1_id, player2_id, partner1_id, partner2_id, score, winner_id,
      player1:profiles!player1_id(id, full_name),
      player2:profiles!player2_id(id, full_name),
      partner1:profiles!partner1_id(id, full_name),
      partner2:profiles!partner2_id(id, full_name),
      winner:profiles!winner_id(id, full_name)
    `)
    .eq('tournament_id', params.id)
    .order('round', { ascending: true })

  const matches = (matchesData ?? []) as unknown as TournamentMatch[]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/torneios" className="text-slate-400 hover:text-white transition-colors mt-1">
          ←
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{t.name}</h1>
            <Badge variant={STATUS_VARIANTS[t.status]}>{STATUS_LABELS[t.status]}</Badge>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {formatDate(t.date, "dd 'de' MMMM 'de' yyyy")} · Nível {t.level.toUpperCase()} ·{' '}
            {t.modality === 'dupla_fixa' ? 'Dupla Fixa' : 'Dupla Revezando'} · Super 8
          </p>
        </div>
      </div>

      {/* Registrations */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          Inscrições ({registrations.length})
        </h2>
        {registrations.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhuma inscrição ainda.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {registrations.map((reg) => {
              const playerRaw = Array.isArray(reg.player) ? reg.player[0] : reg.player
              const partnerRaw = Array.isArray(reg.partner) ? reg.partner[0] : reg.partner
              return (
                <Card key={reg.id}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-white font-medium">
                        {playerRaw?.full_name ?? reg.player_id}
                      </p>
                      {partnerRaw && (
                        <p className="text-xs text-slate-400">
                          Parceiro: {partnerRaw.full_name}
                        </p>
                      )}
                    </div>
                    {playerRaw?.level && (
                      <Badge variant="level">{String(playerRaw.level).toUpperCase()}</Badge>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Bracket — view mode if not in_progress, edit mode if in_progress */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Chave do Torneio</h2>
        {t.status === 'in_progress' ? (
          // Admin edit mode: show MatchResult cards
          matches.length === 0 ? (
            <p className="text-slate-400 text-sm">Nenhum confronto gerado ainda.</p>
          ) : (
            <div className="space-y-6">
              {Array.from(
                matches.reduce((acc, m) => {
                  acc.set(m.round, [...(acc.get(m.round) ?? []), m])
                  return acc
                }, new Map<number, TournamentMatch[]>()),
              )
                .sort(([a], [b]) => a - b)
                .map(([round, roundMatches]) => {
                  const total = matches.reduce((s, m) => Math.max(s, m.round), 0)
                  const fromEnd = total - round + 1
                  const label =
                    fromEnd === 1
                      ? 'Final'
                      : fromEnd === 2
                      ? 'Semifinal'
                      : fromEnd === 3
                      ? 'Quartas de Final'
                      : `Rodada ${round}`
                  return (
                    <div key={round}>
                      <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                        {label}
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {roundMatches.map((match) => (
                          <AdminMatchCard key={match.id} match={match} modality={t.modality} />
                        ))}
                      </div>
                    </div>
                  )
                })}
            </div>
          )
        ) : (
          <BracketView matches={matches} modality={t.modality} />
        )}
      </section>
    </div>
  )
}
