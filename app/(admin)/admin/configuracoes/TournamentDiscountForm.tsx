'use client'
import { useState, useTransition } from 'react'
import { updateTournamentDiscountSettings } from '@/features/torneios/actions'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface Props {
  discount2Pct: number
  discount3Pct: number
}

export function TournamentDiscountForm({ discount2Pct, discount3Pct }: Props) {
  const [d2, setD2] = useState(discount2Pct)
  const [d3, setD3] = useState(discount3Pct)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectClass = 'w-full rounded-lg bg-surface-card border border-surface-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-brand-500'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateTournamentDiscountSettings(d2, d3)
      if (result.error) setError(result.error)
      else setSaved(true)
    })
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Desconto 2º torneio (%)</label>
            <select value={d2} onChange={(e) => setD2(Number(e.target.value))} className={selectClass}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-300">Desconto 3º+ torneio (%)</label>
            <select value={d3} onChange={(e) => setD3(Number(e.target.value))} className={selectClass}>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((v) => (
                <option key={v} value={v}>{v}%</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Aplicado quando o jogador se inscreve em múltiplos torneios pagos na mesma semana (seg–dom).
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && <p className="text-xs text-green-400">✓ Configuração salva</p>}
        <Button type="submit" loading={isPending} size="sm">Salvar</Button>
      </form>
    </Card>
  )
}
