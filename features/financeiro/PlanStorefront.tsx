'use client'
// features/financeiro/PlanStorefront.tsx
// Vitrine de planos do aluno: escolhe periodicidade e assina (redirect ao MP).
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { subscribeToPlanCheckout } from './checkoutActions'
import { PERIODICITY_LABELS, PERIODICITY_MONTHS } from '@/lib/billing/periodicity'
import type { SubscriptionPlan, PlanBillingOption } from '@/types'

interface PlanStorefrontProps {
  plans: SubscriptionPlan[]
  options: PlanBillingOption[]
  mpConnected: boolean
  hasActivePlan: boolean
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

export function PlanStorefront({ plans, options, mpConnected, hasActivePlan }: PlanStorefrontProps) {
  const [selected, setSelected] = useState<Record<string, string>>({}) // planId → optionId
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const plansWithOptions = plans
    .map((plan) => ({
      plan,
      opts: options
        .filter((o) => o.plan_id === plan.id && o.is_enabled && o.price > 0)
        .sort((a, b) => PERIODICITY_MONTHS[a.periodicity] - PERIODICITY_MONTHS[b.periodicity]),
    }))
    .filter(({ opts }) => opts.length > 0)

  if (plansWithOptions.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-400">Nenhum plano disponível no momento.</p>
      </Card>
    )
  }

  function handleSubscribe(planId: string, optionId: string) {
    setError(null)
    startTransition(async () => {
      const result = await subscribeToPlanCheckout(planId, optionId)
      if (result.error || !result.initPoint) setError(result.error ?? 'Erro inesperado.')
      else window.location.href = result.initPoint
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
      )}
      {plansWithOptions.map(({ plan, opts }) => {
        const selectedId = selected[plan.id] ?? opts[0].id
        const selectedOpt = opts.find((o) => o.id === selectedId) ?? opts[0]
        return (
          <Card key={plan.id}>
            <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
            {plan.description && <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>}
            <p className="text-xs text-slate-400 mt-1">
              {plan.classes_per_week}x/semana
            </p>

            <div className="flex flex-wrap gap-2 mt-3">
              {opts.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelected((s) => ({ ...s, [plan.id]: opt.id }))}
                  className={
                    opt.id === selectedOpt.id
                      ? 'px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/20 border border-brand-500 text-brand-500'
                      : 'px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-surface-border text-slate-400'
                  }
                >
                  {PERIODICITY_LABELS[opt.periodicity]} · {formatCurrency(opt.price)}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {mpConnected ? (
                <Button
                  size="sm"
                  variant="primary"
                  loading={pending}
                  disabled={hasActivePlan}
                  onClick={() => handleSubscribe(plan.id, selectedOpt.id)}
                >
                  {hasActivePlan ? 'Você já tem um plano ativo' : 'Assinar'}
                </Button>
              ) : (
                <p className="text-xs text-slate-400">
                  Pagamento online indisponível. Fale com a academia para contratar.
                </p>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
