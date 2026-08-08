'use client'
// app/(admin)/admin/liga/PrizesCard.tsx
// Prêmios da temporada: o que a academia promete e quem já recebeu.
import { useState, useTransition } from 'react'
import { Gift, Trash2, Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils/cn'
import { sportLabel } from '@/lib/arenas/sports'
import { saveLigaPrize, deleteLigaPrize, markPrizeDelivered } from '@/features/liga/prizeActions'
import type { LigaPrize, LigaPrizeAward } from '@/types'

interface Props {
  prizes: LigaPrize[]
  awards: (LigaPrizeAward & { studentName: string })[]
}

const SELECT_CLS =
  'rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

/** Rótulo da faixa premiada. */
function prizeLabel(kind: string, position: number | null): string {
  if (kind === 'promoted') return 'Quem subiu de divisão'
  return `${position}º lugar`
}

export function PrizesCard({ prizes, awards }: Props) {
  const [kind, setKind] = useState<'leader' | 'promoted'>('leader')
  const [position, setPosition] = useState('1')
  const [description, setDescription] = useState('')
  const [creditClasses, setCreditClasses] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await saveLigaPrize({
        kind,
        position: kind === 'leader' ? parseInt(position, 10) : undefined,
        description,
        creditClasses: parseInt(creditClasses, 10) || 0,
      })
      if (result.error) setError(result.error)
      else setDescription('')
    })
  }

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <Gift className="h-4 w-4 text-brand-500" />
        <p className="text-sm font-bold text-white">Prêmios da temporada</p>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        O que está valendo aparece para o aluno na aba Liga, e é o que faz a disputa ter peso. No
        fechamento o sistema apura os ganhadores e avisa cada um.
      </p>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mb-4 space-y-2">
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'leader' | 'promoted')}
            className={cn(SELECT_CLS, 'flex-1')}
          >
            <option value="leader">Colocação no ranking</option>
            <option value="promoted">Quem subiu de divisão</option>
          </select>
          {kind === 'leader' && (
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className={cn(SELECT_CLS, 'w-24')}
            >
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  {p}º
                </option>
              ))}
            </select>
          )}
        </div>

        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex.: mensalidade grátis, camiseta da arena, raquete"
        />

        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-slate-400">
            Aulas creditadas automaticamente (0 = só o prêmio acima)
          </span>
          <Input
            type="number"
            min="0"
            className="w-20 shrink-0"
            value={creditClasses}
            onChange={(e) => setCreditClasses(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" loading={pending}>
          Salvar prêmio
        </Button>
      </form>

      {prizes.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {prizes.map((prize) => (
            <li
              key={prize.id}
              className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface/40 px-3 py-2"
            >
              <span className="w-28 shrink-0 text-xs font-semibold text-brand-500">
                {prizeLabel(prize.kind, prize.position)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                {prize.description}
                {prize.credit_classes > 0 && (
                  <span className="text-slate-400">
                    {' '}
                    + {prize.credit_classes} {prize.credit_classes === 1 ? 'aula' : 'aulas'}
                  </span>
                )}
              </span>
              <button
                onClick={() =>
                  startTransition(async () => {
                    await deleteLigaPrize(prize.id)
                  })
                }
                disabled={pending}
                title="Remover prêmio"
                className="shrink-0 rounded-lg p-1 text-slate-500 transition-colors hover:bg-surface-border hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {awards.length > 0 && (
        <>
          <p className="mb-2 text-xs tracking-wide text-slate-400">GANHADORES A ENTREGAR</p>
          <ul className="space-y-1.5">
            {awards.map((award) => (
              <li key={award.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-200">{award.studentName}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {prizeLabel(award.kind, award.position)} · {sportLabel(award.sport)} ·{' '}
                    {award.description}
                  </span>
                </span>
                <button
                  onClick={() =>
                    startTransition(async () => {
                      await markPrizeDelivered(award.id, !award.delivered)
                    })
                  }
                  disabled={pending}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    award.delivered
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-surface-border text-slate-400 hover:text-slate-200',
                  )}
                >
                  {award.delivered ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      entregue
                    </span>
                  ) : (
                    'marcar entregue'
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
