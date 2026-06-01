'use client'
// app/(admin)/financeiro/PlansManager.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { togglePlanActive, updatePlanPrice } from './adminActions'
import type { SubscriptionPlan } from '@/types'

interface PlansManagerProps {
  plans: SubscriptionPlan[]
}

interface EditState {
  price_monthly: string
  price_quarterly: string
  price_annual: string
}

export function PlansManager({ plans: initialPlans }: PlansManagerProps) {
  const [plans, setPlans] = useState(initialPlans)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<EditState>({ price_monthly: '', price_quarterly: '', price_annual: '' })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function startEdit(plan: SubscriptionPlan) {
    setEditingId(plan.id)
    setEditValues({
      price_monthly: String(plan.price_monthly),
      price_quarterly: String(plan.price_quarterly),
      price_annual: String(plan.price_annual),
    })
    setError(null)
    setSuccess(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  function handleToggle(planId: string, current: boolean) {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await togglePlanActive(planId, !current)
      if (result.error) {
        setError(result.error)
      } else {
        setPlans((prev) =>
          prev.map((p) => (p.id === planId ? { ...p, is_active: !current } : p)),
        )
        setSuccess(`Plano ${!current ? 'ativado' : 'desativado'} com sucesso.`)
      }
    })
  }

  function handleSavePrice(planId: string) {
    const monthly = parseFloat(editValues.price_monthly)
    const quarterly = parseFloat(editValues.price_quarterly)
    const annual = parseFloat(editValues.price_annual)

    if (isNaN(monthly) || isNaN(quarterly) || isNaN(annual)) {
      setError('Por favor, insira valores numéricos válidos.')
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await updatePlanPrice(planId, {
        price_monthly: monthly,
        price_quarterly: quarterly,
        price_annual: annual,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setPlans((prev) =>
          prev.map((p) =>
            p.id === planId
              ? { ...p, price_monthly: monthly, price_quarterly: quarterly, price_annual: annual }
              : p,
          ),
        )
        setEditingId(null)
        setSuccess('Preços atualizados com sucesso.')
      }
    })
  }

  function formatCurrency(amount: number) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
          {success}
        </p>
      )}

      {plans.map((plan) => (
        <Card key={plan.id}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                <Badge variant={plan.is_active ? 'success' : 'danger'}>
                  {plan.is_active ? 'Ativo' : 'Inativo'}
                </Badge>
              </div>
              {plan.description && (
                <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
              )}
              <p className="text-xs text-slate-400 mt-1">
                {plan.classes_per_week}x/semana · {plan.credits_per_month} créditos/mês
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant={plan.is_active ? 'danger' : 'secondary'}
                loading={pending}
                onClick={() => handleToggle(plan.id, plan.is_active)}
              >
                {plan.is_active ? 'Desativar' : 'Ativar'}
              </Button>
              {editingId !== plan.id && (
                <Button size="sm" variant="ghost" onClick={() => startEdit(plan)}>
                  Preços
                </Button>
              )}
            </div>
          </div>

          {editingId === plan.id ? (
            <div className="space-y-3 pt-3 border-t border-surface-border">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Editar preços</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Mensal (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_monthly}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_monthly: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Trimestral (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_quarterly}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_quarterly: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Anual (R$)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editValues.price_annual}
                    onChange={(e) => setEditValues((v) => ({ ...v, price_annual: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  loading={pending}
                  onClick={() => handleSavePrice(plan.id)}
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={pending}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-surface-border">
              <div>
                <span className="text-slate-400">Mensal</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_monthly)}</p>
              </div>
              <div>
                <span className="text-slate-400">Trimestral</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_quarterly)}</p>
              </div>
              <div>
                <span className="text-slate-400">Anual</span>
                <p className="text-white font-medium">{formatCurrency(plan.price_annual)}</p>
              </div>
            </div>
          )}
        </Card>
      ))}

      {plans.length === 0 && (
        <p className="text-sm text-slate-400">Nenhum plano cadastrado.</p>
      )}
    </div>
  )
}
