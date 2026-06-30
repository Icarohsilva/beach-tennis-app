'use client'
// app/(admin)/admin/torneios/[id]/WinnersCard.tsx
// Pódio editável — ativo só depois de encerrar o torneio.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateWinners } from '@/features/torneios/actions'

interface Player { id: string; full_name: string }

interface WinnersCardProps {
  tournamentId: string
  isFinished: boolean
  winner1Id: string | null
  winner2Id: string | null
  winner3Id: string | null
  allPlayers: Player[]
}

export function WinnersCard({
  tournamentId,
  isFinished,
  winner1Id,
  winner2Id,
  winner3Id,
  allPlayers,
}: WinnersCardProps) {
  const [w1, setW1] = useState(winner1Id ?? '')
  const [w2, setW2] = useState(winner2Id ?? '')
  const [w3, setW3] = useState(winner3Id ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateWinners(tournamentId, {
        winner1_id: w1 || null,
        winner2_id: w2 || null,
        winner3_id: w3 || null,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
      }
    })
  }

  const selectClass =
    'w-full rounded-lg bg-surface border border-surface-border px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-40'

  const slots = [
    { emoji: '🥇', label: '1º lugar', val: w1, set: setW1 },
    { emoji: '🥈', label: '2º lugar', val: w2, set: setW2 },
    { emoji: '🥉', label: '3º lugar', val: w3, set: setW3 },
  ]

  return (
    <Card className={isFinished ? '' : 'opacity-50 pointer-events-none'}>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
        🏆 Resultado final{!isFinished && ' (disponível ao encerrar)'}
      </p>
      <div className="grid gap-2">
        {slots.map(({ emoji, label, val, set }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-sm w-6 shrink-0">{emoji}</span>
            <span className="text-xs text-slate-400 w-16 shrink-0">{label}</span>
            <select
              value={val}
              onChange={(e) => set(e.target.value)}
              className={selectClass}
              disabled={!isFinished || isPending}
            >
              <option value="">—</option>
              {allPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {isFinished && (
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={handleSave} loading={isPending} size="sm">
            Salvar resultado
          </Button>
          {saved && <span className="text-xs text-green-400">Salvo!</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      )}
    </Card>
  )
}
