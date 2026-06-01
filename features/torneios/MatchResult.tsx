'use client'
// features/torneios/MatchResult.tsx
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { recordMatchResult } from './actions'
import type { TournamentMatch } from './BracketView'
import type { TournamentModality } from '@/types'

interface MatchResultProps {
  match: TournamentMatch
  modality: TournamentModality
  isAdmin?: boolean
  onResultSaved?: () => void
}

export function MatchResult({ match, modality, isAdmin = false, onResultSaved }: MatchResultProps) {
  const [editing, setEditing] = useState(false)
  const [score, setScore] = useState(match.score ?? '')
  const [winnerId, setWinnerId] = useState<string>(match.winner_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const p1Name = match.player1?.full_name ?? 'TBD'
  const p2Name = match.player2?.full_name ?? 'TBD'
  const p1Label =
    modality === 'dupla_fixa' && match.partner1
      ? `${p1Name} / ${match.partner1.full_name}`
      : p1Name
  const p2Label =
    modality === 'dupla_fixa' && match.partner2
      ? `${p2Name} / ${match.partner2.full_name}`
      : p2Name

  const isP1Winner = match.winner_id === match.player1_id
  const isP2Winner = match.winner_id === match.player2_id

  function handleSave() {
    if (!winnerId) {
      setError('Selecione o vencedor.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await recordMatchResult(match.id, score, winnerId)
      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
        onResultSaved?.()
      }
    })
  }

  // View mode (no edit)
  if (!editing) {
    return (
      <div className="space-y-2">
        {/* Player 1 row */}
        <div
          className={`flex items-center justify-between gap-2 py-2 px-3 rounded ${
            isP1Winner ? 'bg-green-500/10' : ''
          }`}
        >
          <span
            className={`text-sm font-medium ${
              isP1Winner ? 'text-green-400' : 'text-slate-300'
            }`}
          >
            {p1Label}
          </span>
          {isP1Winner && <Badge variant="success">Vencedor</Badge>}
        </div>

        {/* Score */}
        {match.score && (
          <p className="text-center text-xs text-slate-400 font-mono">{match.score}</p>
        )}

        {/* Player 2 row */}
        <div
          className={`flex items-center justify-between gap-2 py-2 px-3 rounded ${
            isP2Winner ? 'bg-green-500/10' : ''
          }`}
        >
          <span
            className={`text-sm font-medium ${
              isP2Winner ? 'text-green-400' : 'text-slate-300'
            }`}
          >
            {p2Label}
          </span>
          {isP2Winner && <Badge variant="success">Vencedor</Badge>}
        </div>

        {/* Admin edit button — only if both players exist and no winner yet */}
        {isAdmin && match.player1_id && match.player2_id && !match.winner_id && (
          <div className="pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Lançar Resultado
            </Button>
          </div>
        )}

        {/* Admin edit button — winner already set */}
        {isAdmin && match.winner_id && (
          <div className="pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(true); setScore(match.score ?? ''); setWinnerId(match.winner_id ?? '') }}>
              Editar Resultado
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Edit mode (admin only)
  return (
    <div className="space-y-3">
      <Input
        label="Placar (ex: 6-4, 7-5)"
        value={score}
        onChange={(e) => setScore(e.target.value)}
        placeholder="6-4, 7-5"
      />

      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-300">Vencedor</p>
        {match.player1_id && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={`winner-${match.id}`}
              value={match.player1_id}
              checked={winnerId === match.player1_id}
              onChange={() => setWinnerId(match.player1_id!)}
              className="accent-brand-600"
            />
            <span className="text-sm text-slate-300">{p1Label}</span>
          </label>
        )}
        {match.player2_id && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name={`winner-${match.id}`}
              value={match.player2_id}
              checked={winnerId === match.player2_id}
              onChange={() => setWinnerId(match.player2_id!)}
              className="accent-brand-600"
            />
            <span className="text-sm text-slate-300">{p2Label}</span>
          </label>
        )}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" loading={isPending} onClick={handleSave}>
          Salvar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  )
}
