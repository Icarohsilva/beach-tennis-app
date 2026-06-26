'use client'
// app/(admin)/admin/financeiro/PartnerRevenueCard.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  setPartnerCheckinRate,
  getPartnerRevenueThisMonth,
} from '@/features/financeiro/partnerRevenueActions'
import type { PartnerRates, PartnerRevenue } from '@/lib/checkin/partnerRevenue'

interface Props {
  initialRates: PartnerRates
  initialRevenue: PartnerRevenue
  hasZeroTargetStudents: boolean
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PartnerRevenueCard({ initialRates, initialRevenue, hasZeroTargetStudents }: Props) {
  const [wellhub, setWellhub] = useState(String(initialRates.wellhub))
  const [totalpass, setTotalpass] = useState(String(initialRates.totalpass))
  const [revenue, setRevenue] = useState<PartnerRevenue>(initialRevenue)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [savePending, startSave] = useTransition()
  const [recalcPending, startRecalc] = useTransition()

  function handleSave() {
    setError(null)
    setSuccess(null)
    const w = parseFloat(wellhub)
    const t = parseFloat(totalpass)
    if (isNaN(w) || isNaN(t) || w < 0 || t < 0) {
      setError('Informe valores numéricos válidos (≥ 0).')
      return
    }
    startSave(async () => {
      const r1 = await setPartnerCheckinRate('wellhub', w)
      if (r1.error) return setError(r1.error)
      const r2 = await setPartnerCheckinRate('totalpass', t)
      if (r2.error) return setError(r2.error)
      const updated = await getPartnerRevenueThisMonth()
      setRevenue(updated)
      setSuccess('Valores salvos.')
    })
  }

  function handleRecalc() {
    setError(null)
    setSuccess(null)
    startRecalc(async () => {
      const updated = await getPartnerRevenueThisMonth()
      setRevenue(updated)
      setSuccess('Receita recalculada.')
    })
  }

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">
          Valor por check-in
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Wellhub (R$)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={wellhub}
              onChange={(e) => setWellhub(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">TotalPass (R$)</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={totalpass}
              onChange={(e) => setTotalpass(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 mt-3">
            {success}
          </p>
        )}
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="primary" loading={savePending} onClick={handleSave}>
            Salvar valores
          </Button>
          <Button size="sm" variant="ghost" loading={recalcPending} onClick={handleRecalc}>
            Recalcular
          </Button>
        </div>
      </Card>

      <Card>
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-1">
          A receber (mês seguinte)
        </p>
        <p className="text-2xl font-bold text-green-400">{formatCurrency(revenue.total)}</p>
        <div className="grid grid-cols-2 gap-2 text-xs mt-3 pt-3 border-t border-surface-border">
          <div>
            <span className="text-slate-400">Wellhub</span>
            <p className="text-white font-medium">{formatCurrency(revenue.perPartner.wellhub)}</p>
          </div>
          <div>
            <span className="text-slate-400">TotalPass</span>
            <p className="text-white font-medium">{formatCurrency(revenue.perPartner.totalpass)}</p>
          </div>
        </div>
        {hasZeroTargetStudents && (
          <p className="text-xs text-yellow-400 mt-3">
            Há alunos de parceiro com meta mensal 0 (não somam). Defina a meta na ficha do aluno.
          </p>
        )}
      </Card>
    </div>
  )
}
