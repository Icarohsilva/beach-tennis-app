'use client'
// features/financeiro/PlanSelector.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { SubscriptionPlan } from '@/types'
import { subscribeToPlan } from './actions'

interface PlanSelectorProps {
  plans: SubscriptionPlan[]
  currentPlanId?: string | null
}

export function PlanSelector({ plans, currentPlanId }: PlanSelectorProps) {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null)

  function handleSubscribe(planId: string) {
    setError(null)
    setSuccess(null)
    setLoadingPlanId(planId)
    startTransition(async () => {
      const result = await subscribeToPlan(planId)
      setLoadingPlanId(null)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess('Assinatura realizada com sucesso!')
      }
    })
  }

  if (plans.length === 0) {
    return <p className="text-sm text-slate-400">Nenhum plano disponível no momento.</p>
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

      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlanId
        return (
          <Card key={plan.id} className={isCurrent ? 'border-brand-600/60' : undefined}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-white font-semibold text-sm">{plan.name}</h4>
                  {isCurrent && (
                    <span className="text-xs text-brand-500 font-medium">Plano atual</span>
                  )}
                </div>
                {plan.description && (
                  <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-xs text-slate-400">
                  <span>{plan.classes_per_week}x/semana</span>
                  <span>{plan.credits_per_month} crédito{plan.credits_per_month !== 1 ? 's' : ''}/mês</span>
                </div>
              </div>
              <div className="shrink-0">
                {!isCurrent && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={pending && loadingPlanId === plan.id}
                    disabled={pending}
                    onClick={() => handleSubscribe(plan.id)}
                  >
                    Assinar
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
