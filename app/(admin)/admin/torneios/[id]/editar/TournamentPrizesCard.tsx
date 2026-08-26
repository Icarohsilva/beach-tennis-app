'use client'
// app/(admin)/admin/torneios/[id]/editar/TournamentPrizesCard.tsx
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { upsertTournamentPrize, deleteTournamentPrize, markPrizeDelivered } from '@/features/torneios/configActions'
import { positionLabel, totalPrizeCents, type PrizeRow } from '@/lib/torneios/prizes'

interface Props {
  tournamentId: string
  initialPrizes: PrizeRow[]
}

function inputToCents(v: string): number | null {
  const n = parseFloat(v.replace(',', '.'))
  return v.trim() && !isNaN(n) && n >= 0 ? Math.round(n * 100) : null
}

export function TournamentPrizesCard({ tournamentId, initialPrizes }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<'podium' | 'special'>('podium')
  const [position, setPosition] = useState(1)
  const [description, setDescription] = useState('')
  const [valueInput, setValueInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function addPrize() {
    setError(null)
    if (!description.trim()) {
      setError('Descreva o prêmio.')
      return
    }
    startTransition(async () => {
      const res = await upsertTournamentPrize(tournamentId, {
        kind,
        position: kind === 'podium' ? position : null,
        description,
        value_cents: inputToCents(valueInput),
      })
      if (res.error) {
        setError(res.error)
        return
      }
      setDescription('')
      setValueInput('')
      router.refresh()
    })
  }

  function remove(prizeId: string) {
    startTransition(async () => {
      const res = await deleteTournamentPrize(prizeId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function toggleDelivered(prizeId: string, delivered: boolean) {
    startTransition(async () => {
      const res = await markPrizeDelivered(prizeId, delivered)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  const total = totalPrizeCents(initialPrizes)

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Premiação</h2>
        {total > 0 && (
          <span className="text-xs text-slate-400">
            Total: R$ {(total / 100).toFixed(2).replace('.', ',')}
          </span>
        )}
      </div>

      {initialPrizes.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum prêmio cadastrado ainda.</p>
      ) : (
        <div className="mb-4 space-y-2">
          {initialPrizes.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface px-3 py-2 xs:flex-row xs:items-center xs:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm text-white">
                  {p.kind === 'podium' ? positionLabel(p.position as number) : 'Especial'} — {p.description}
                  {p.value_cents !== null && (
                    <span className="text-slate-400"> · R$ {(p.value_cents / 100).toFixed(2).replace('.', ',')}</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={!!p.delivered_at}
                    onChange={(e) => toggleDelivered(p.id, e.target.checked)}
                    disabled={isPending}
                    className="accent-brand-600"
                  />
                  Entregue
                </label>
                <button
                  onClick={() => remove(p.id)}
                  disabled={isPending}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-surface-border bg-surface-card/60 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Adicionar prêmio</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setKind('podium')}
            className={`rounded-lg border px-3 py-1.5 text-sm ${kind === 'podium' ? 'border-brand-600 bg-brand-600/20 text-brand-400' : 'border-surface-border text-slate-400 hover:text-white'}`}
          >
            Pódio
          </button>
          <button
            onClick={() => setKind('special')}
            className={`rounded-lg border px-3 py-1.5 text-sm ${kind === 'special' ? 'border-brand-600 bg-brand-600/20 text-brand-400' : 'border-surface-border text-slate-400 hover:text-white'}`}
          >
            Especial
          </button>
          {kind === 'podium' && (
            <select
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-sm text-white"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{positionLabel(n)}</option>
              ))}
            </select>
          )}
        </div>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex: Kit de raquetes + troféu"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <input
          type="text"
          inputMode="decimal"
          value={valueInput}
          onChange={(e) => setValueInput(e.target.value)}
          placeholder="Valor em R$ (opcional — deixe vazio para prêmio só em texto)"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" onClick={addPrize} loading={isPending}>
            Adicionar
          </Button>
        </div>
      </div>
    </Card>
  )
}
