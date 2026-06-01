// features/torneios/BracketView.tsx
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import type { TournamentModality } from '@/types'

export interface TournamentMatch {
  id: string
  tournament_id: string
  round: number
  player1_id: string | null
  player2_id: string | null
  partner1_id: string | null
  partner2_id: string | null
  score: string | null
  winner_id: string | null
  player1?: { id: string; full_name: string } | null
  player2?: { id: string; full_name: string } | null
  partner1?: { id: string; full_name: string } | null
  partner2?: { id: string; full_name: string } | null
  winner?: { id: string; full_name: string } | null
}

interface BracketViewProps {
  matches: TournamentMatch[]
  modality: TournamentModality
}

function getPlayerLabel(
  match: TournamentMatch,
  side: 'player1' | 'player2',
  modality: TournamentModality,
): string {
  if (side === 'player1') {
    const name = match.player1?.full_name ?? 'TBD'
    if (modality === 'dupla_fixa' && match.partner1) {
      return `${name} / ${match.partner1.full_name}`
    }
    return name
  } else {
    const name = match.player2?.full_name ?? 'TBD'
    if (modality === 'dupla_fixa' && match.partner2) {
      return `${name} / ${match.partner2.full_name}`
    }
    return name
  }
}

export function BracketView({ matches, modality }: BracketViewProps) {
  if (matches.length === 0) {
    return (
      <p className="text-slate-400 text-sm text-center py-4">
        Nenhum confronto gerado ainda.
      </p>
    )
  }

  // Group matches by round
  const rounds = new Map<number, TournamentMatch[]>()
  for (const match of matches) {
    const arr = rounds.get(match.round) ?? []
    arr.push(match)
    rounds.set(match.round, arr)
  }

  const sortedRounds = Array.from(rounds.keys()).sort((a, b) => a - b)

  const roundLabel = (round: number): string => {
    const total = sortedRounds.length
    const fromEnd = total - sortedRounds.indexOf(round)
    if (fromEnd === 1) return 'Final'
    if (fromEnd === 2) return 'Semifinal'
    if (fromEnd === 3) return 'Quartas de Final'
    return `Rodada ${round}`
  }

  return (
    <div className="space-y-6">
      {sortedRounds.map((round) => {
        const roundMatches = rounds.get(round) ?? []
        return (
          <div key={round}>
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
              {roundLabel(round)}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {roundMatches.map((match) => {
                const p1Label = getPlayerLabel(match, 'player1', modality)
                const p2Label = getPlayerLabel(match, 'player2', modality)
                const isP1Winner = match.winner_id === match.player1_id
                const isP2Winner = match.winner_id === match.player2_id
                const hasResult = match.winner_id !== null

                return (
                  <Card key={match.id} className="p-3">
                    {/* Player 1 */}
                    <div
                      className={`flex items-center justify-between py-1.5 px-2 rounded mb-1 ${
                        isP1Winner ? 'bg-green-500/10' : ''
                      }`}
                    >
                      <span
                        className={`text-sm truncate max-w-[70%] ${
                          isP1Winner ? 'text-green-400 font-semibold' : 'text-slate-300'
                        } ${!match.player1_id ? 'text-slate-500 italic' : ''}`}
                      >
                        {p1Label}
                      </span>
                      {isP1Winner && (
                        <Badge variant="success" className="shrink-0">
                          Vencedor
                        </Badge>
                      )}
                    </div>

                    {/* Divider with score */}
                    <div className="flex items-center gap-2 my-1">
                      <div className="flex-1 h-px bg-surface-border" />
                      {match.score && (
                        <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                          {match.score}
                        </span>
                      )}
                      {!hasResult && !match.score && (
                        <span className="text-xs text-slate-500">vs</span>
                      )}
                      <div className="flex-1 h-px bg-surface-border" />
                    </div>

                    {/* Player 2 */}
                    <div
                      className={`flex items-center justify-between py-1.5 px-2 rounded mt-1 ${
                        isP2Winner ? 'bg-green-500/10' : ''
                      }`}
                    >
                      <span
                        className={`text-sm truncate max-w-[70%] ${
                          isP2Winner ? 'text-green-400 font-semibold' : 'text-slate-300'
                        } ${!match.player2_id ? 'text-slate-500 italic' : ''}`}
                      >
                        {p2Label}
                      </span>
                      {isP2Winner && (
                        <Badge variant="success" className="shrink-0">
                          Vencedor
                        </Badge>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
