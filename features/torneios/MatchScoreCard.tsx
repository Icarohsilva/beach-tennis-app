'use client'
// features/torneios/MatchScoreCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PlayerAvatar } from './PlayerAvatar'
import { teamLabel } from '@/lib/torneios/display'
import { cn } from '@/lib/utils/cn'
import {
  reportMatchResult,
  confirmMatchResult,
  recordMatchResult,
  scheduleMatch,
} from './actions'
import {
  canReportResult,
  canConfirmResult,
  type EligibilityMatch,
} from '@/lib/torneios/eligibility'
import {
  formatMatchDateTime,
  isoToBrtLocalInput,
  brtLocalToIso,
} from '@/lib/torneios/matchTime'

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
  played_at: string | null
  player1?: { full_name: string } | null
  partner1?: { full_name: string } | null
  player2?: { full_name: string } | null
  partner2?: { full_name: string } | null
}

interface MatchScoreCardProps {
  match: ScoreMatch
  currentUserId?: string
  isAdmin: boolean
  /** Rótulo opcional (ex: "Rodada 2") mostrado no topo do card. */
  roundLabel?: string
  /** Visitante público: mostra placar/badges, esconde lançar/confirmar/agendar. */
  readOnly?: boolean
}

export function MatchScoreCard({ match, currentUserId = '', isAdmin, roundLabel, readOnly = false }: MatchScoreCardProps) {
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
  const iCanReport = !readOnly && (isAdmin || canReportResult(currentUserId, elig))
  const confirmed = match.result_status === 'confirmed'
  const pending = match.result_status === 'pending'
  const iCanConfirm = !readOnly && pending && canConfirmResult(currentUserId, elig, isAdmin)

  const team1 = teamLabel([match.player1?.full_name, match.partner1?.full_name])
  const team2 = teamLabel([match.player2?.full_name, match.partner2?.full_name])
  const names1 = [match.player1?.full_name, match.partner1?.full_name].filter(Boolean) as string[]
  const names2 = [match.player2?.full_name, match.partner2?.full_name].filter(Boolean) as string[]

  const mySide: 1 | 2 | null =
    currentUserId && (currentUserId === match.player1_id || currentUserId === match.partner1_id)
      ? 1
      : currentUserId && (currentUserId === match.player2_id || currentUserId === match.partner2_id)
      ? 2
      : null

  const canSchedule = !readOnly && (isAdmin || mySide !== null)
  const [schedOpen, setSchedOpen] = useState(false)
  const [schedValue, setSchedValue] = useState<string>(
    match.played_at ? isoToBrtLocalInput(match.played_at) : '',
  )
  const [schedError, setSchedError] = useState<string | null>(null)
  const [schedPending, startSchedTransition] = useTransition()

  function saveSchedule() {
    const iso = brtLocalToIso(schedValue)
    if (!iso) {
      setSchedError('Informe uma data e hora válidas.')
      return
    }
    setSchedError(null)
    startSchedTransition(async () => {
      const res = await scheduleMatch(match.id, iso)
      if (res.error) setSchedError(res.error)
      else {
        setSchedOpen(false)
        router.refresh()
      }
    })
  }

  function clearSchedule() {
    setSchedError(null)
    startSchedTransition(async () => {
      const res = await scheduleMatch(match.id, null)
      if (res.error) setSchedError(res.error)
      else {
        setSchedOpen(false)
        router.refresh()
      }
    })
  }

  const hasScore = match.games1 !== null && match.games2 !== null
  const winner: 1 | 2 | 0 =
    confirmed && hasScore
      ? (match.games1 as number) > (match.games2 as number)
        ? 1
        : (match.games2 as number) > (match.games1 as number)
        ? 2
        : 0
      : 0

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

  const showReport = iCanReport && !confirmed
  const showAdminCorrect = !readOnly && isAdmin && confirmed
  const showWaiting = !readOnly && pending && !iCanConfirm && !isAdmin
  const showFooter = editing || showReport || showAdminCorrect || iCanConfirm || showWaiting || !!error

  // Slot de placar (à direita do nome do time). Em edição vira input inline.
  function scoreSlot(side: 1 | 2) {
    const value = side === 1 ? match.games1 : match.games2
    const isWinner = winner === side
    if (editing) {
      return (
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={side === 1 ? g1 : g2}
          onChange={(e) => (side === 1 ? setG1(e.target.value) : setG2(e.target.value))}
          aria-label={`Games ${side === 1 ? team1 : team2}`}
          className="h-11 w-12 shrink-0 rounded-lg border border-brand-500/50 bg-surface text-center text-xl font-bold text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      )
    }
    return (
      <div
        className={cn(
          'flex h-11 w-12 shrink-0 items-center justify-center rounded-lg text-xl font-bold tabular-nums',
          isWinner
            ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
            : hasScore
            ? 'bg-surface text-slate-200'
            : 'bg-surface text-slate-600',
        )}
      >
        {hasScore ? value : '–'}
      </div>
    )
  }

  function teamRow(side: 1 | 2) {
    const names = side === 1 ? names1 : names2
    const label = side === 1 ? team1 : team2
    const tone = side === 1 ? 'brand' : 'sky'
    const isMine = mySide === side
    const isWinner = winner === side
    return (
      <div className={cn('flex items-center gap-3 px-3 py-2.5', isMine && 'bg-brand-500/[0.07]')}>
        <div className="flex -space-x-2">
          {(names.length > 0 ? names : [null]).map((n, i) => (
            <PlayerAvatar key={i} name={n} tone={tone} className="ring-2 ring-surface-card" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate text-sm font-semibold',
              isWinner ? 'text-white' : confirmed ? 'text-slate-400' : 'text-slate-200',
            )}
          >
            {label}
          </p>
          {isMine && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-400">Seu time</span>
          )}
        </div>
        {isWinner && <span title="Vencedor" className="text-sm">🏆</span>}
        {scoreSlot(side)}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-surface-card',
        mySide ? 'border-brand-500/40' : 'border-surface-border',
      )}
    >
      {(roundLabel || match.result_status) && (
        <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {roundLabel ?? ''}
          </span>
          {confirmed && <Badge variant="success">Confirmado</Badge>}
          {pending && <Badge variant="warning">Aguardando confirmação</Badge>}
        </div>
      )}

      {/* Data/hora do confronto */}
      <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span aria-hidden>📅</span>
          {match.played_at ? formatMatchDateTime(match.played_at) : 'Sem data/hora'}
        </span>
        {canSchedule && !schedOpen && (
          <button
            type="button"
            onClick={() => {
              setSchedValue(match.played_at ? isoToBrtLocalInput(match.played_at) : '')
              setSchedError(null)
              setSchedOpen(true)
            }}
            className="text-xs font-semibold text-brand-400 hover:text-brand-300"
          >
            {match.played_at ? 'Editar' : 'Marcar data/hora'}
          </button>
        )}
      </div>
      {schedOpen && (
        <div className="space-y-2 border-b border-surface-border px-3 py-2.5">
          {schedError && <p className="text-xs text-red-400">{schedError}</p>}
          <input
            type="datetime-local"
            value={schedValue}
            onChange={(e) => setSchedValue(e.target.value)}
            aria-label="Data e hora do confronto"
            className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={schedPending} onClick={saveSchedule}>
              Salvar
            </Button>
            {match.played_at && (
              <Button size="sm" variant="ghost" disabled={schedPending} onClick={clearSchedule}>
                Limpar
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={schedPending}
              onClick={() => {
                setSchedOpen(false)
                setSchedError(null)
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {teamRow(1)}
      <div className="relative">
        <div className="mx-3 border-t border-dashed border-surface-border" />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          vs
        </span>
      </div>
      {teamRow(2)}

      {showFooter && (
        <div className="border-t border-surface-border px-3 py-2.5">
          {editing ? (
            <div className="space-y-2">
              {error && <p className="text-xs text-red-400">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" loading={isPending} onClick={save}>
                  Salvar placar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    setEditing(false)
                    setError(null)
                    setG1(match.games1?.toString() ?? '')
                    setG2(match.games2?.toString() ?? '')
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {showReport && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  {hasScore ? 'Editar placar' : 'Lançar placar'}
                </Button>
              )}
              {showAdminCorrect && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Corrigir
                </Button>
              )}
              {iCanConfirm && (
                <Button size="sm" onClick={confirm} loading={isPending}>
                  Confirmar placar
                </Button>
              )}
              {showWaiting && (
                <span className="text-xs text-slate-500">Aguardando a outra dupla confirmar.</span>
              )}
              {error && <p className="w-full text-xs text-red-400">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
