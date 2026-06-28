'use client'
// features/torneios/MatchScoreCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  reportMatchResult,
  confirmMatchResult,
  recordMatchResult,
} from './actions'
import {
  canReportResult,
  canConfirmResult,
  type EligibilityMatch,
} from '@/lib/torneios/eligibility'

export interface ScoreMatch {
  id: string
  player1_id: string
  partner1_id: string | null
  player2_id: string
  partner2_id: string | null
  games1: number | null
  games2: number | null
  result_status: 'pending' | 'confirmed' | null
  reported_by: string | null
  player1?: { full_name: string } | null
  partner1?: { full_name: string } | null
  player2?: { full_name: string } | null
  partner2?: { full_name: string } | null
}

interface MatchScoreCardProps {
  match: ScoreMatch
  currentUserId: string
  isAdmin: boolean
}

function sideLabel(name?: string | null, partner?: string | null): string {
  const n = name ?? 'TBD'
  return partner ? `${n} / ${partner}` : n
}

export function MatchScoreCard({ match, currentUserId, isAdmin }: MatchScoreCardProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [g1, setG1] = useState<string>(match.games1?.toString() ?? '')
  const [g2, setG2] = useState<string>(match.games2?.toString() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const elig: EligibilityMatch = {
    player1_id: match.player1_id,
    partner1_id: match.partner1_id,
    player2_id: match.player2_id,
    partner2_id: match.partner2_id,
    reported_by: match.reported_by,
  }
  const iCanReport = isAdmin || canReportResult(currentUserId, elig)
  const iCanConfirm =
    match.result_status === 'pending' && canConfirmResult(currentUserId, elig, isAdmin)

  const p1 = sideLabel(match.player1?.full_name, match.partner1?.full_name)
  const p2 = sideLabel(match.player2?.full_name, match.partner2?.full_name)

  function save() {
    const n1 = Number(g1)
    const n2 = Number(g2)
    if (!Number.isInteger(n1) || !Number.isInteger(n2) || n1 < 0 || n2 < 0) {
      setError('Informe um placar válido (games por lado).')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = isAdmin
        ? await recordMatchResult(match.id, n1, n2)
        : await reportMatchResult(match.id, n1, n2)
      if (res.error) setError(res.error)
      else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await confirmMatchResult(match.id)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  const hasScore = match.games1 !== null && match.games2 !== null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-300">{p1}</span>
        <span className="text-sm font-mono text-white">{hasScore ? match.games1 : '–'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-slate-300">{p2}</span>
        <span className="text-sm font-mono text-white">{hasScore ? match.games2 : '–'}</span>
      </div>

      <div className="flex items-center gap-2">
        {match.result_status === 'confirmed' && <Badge variant="success">Confirmado</Badge>}
        {match.result_status === 'pending' && <Badge variant="warning">Aguardando confirmação</Badge>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={g1}
              onChange={(e) => setG1(e.target.value)}
              placeholder="Games dupla 1"
              className="w-24 rounded-lg bg-surface border border-surface-border px-2 py-1 text-white text-sm"
            />
            <input
              type="number"
              min={0}
              value={g2}
              onChange={(e) => setG2(e.target.value)}
              placeholder="Games dupla 2"
              className="w-24 rounded-lg bg-surface border border-surface-border px-2 py-1 text-white text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={isPending} onClick={save}>Salvar</Button>
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => { setEditing(false); setError(null) }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {iCanReport && match.result_status !== 'confirmed' && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {hasScore ? 'Editar placar' : 'Lançar placar'}
            </Button>
          )}
          {isAdmin && match.result_status === 'confirmed' && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Corrigir</Button>
          )}
          {iCanConfirm && (
            <Button size="sm" onClick={confirm} loading={isPending}>Confirmar placar</Button>
          )}
          {match.result_status === 'pending' && !iCanConfirm && !isAdmin && (
            <span className="text-xs text-slate-500 self-center">Aguardando a outra dupla confirmar.</span>
          )}
          {error && <p className="text-xs text-red-400 w-full">{error}</p>}
        </div>
      )}
    </div>
  )
}
