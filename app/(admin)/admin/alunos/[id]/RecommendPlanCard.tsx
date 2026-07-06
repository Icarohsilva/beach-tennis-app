'use client'
// app/(admin)/admin/alunos/[id]/RecommendPlanCard.tsx
// Indicar plano + status da assinatura MP do aluno. Complementa (não substitui)
// o "Atribuir plano" manual do StudentProfileClient.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { recommendPlanToStudent } from '@/features/financeiro/recommendationActions'
import { PERIODICITY_LABELS } from '@/lib/billing/periodicity'
import type { PlanBillingOption } from '@/types'

interface RecommendPlanCardProps {
  studentId: string
  plans: { id: string; name: string }[]
  options: PlanBillingOption[]
  mpSubscription: {
    status: string
    gateway: string
    current_period_end: string | null
  } | null
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}

function mpStatusBadge(sub: RecommendPlanCardProps['mpSubscription']) {
  if (!sub || sub.gateway !== 'mercadopago') return null
  if (sub.status === 'pending_payment') return <Badge variant="warning">MP: aguardando pagamento</Badge>
  if (sub.status === 'past_due') return <Badge variant="danger">MP: pagamento vencido</Badge>
  const current = sub.current_period_end && new Date(sub.current_period_end) >= new Date()
  return current
    ? <Badge variant="success">MP: em dia</Badge>
    : <Badge variant="danger">MP: período vencido</Badge>
}

export function RecommendPlanCard({ studentId, plans, options, mpSubscription }: RecommendPlanCardProps) {
  const [planId, setPlanId] = useState('')
  const [optionId, setOptionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const planOptions = options.filter((o) => o.plan_id === planId && o.is_enabled)

  function handleRecommend() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await recommendPlanToStudent(studentId, planId, optionId)
      if (result.error) setError(result.error)
      else setSuccess('Indicação enviada! O aluno verá o convite no app.')
    })
  }

  return (
    <Card>
      <div className="flex items-center gap-2">
        <h3 className="text-white font-semibold text-sm">Indicar plano</h3>
        {mpStatusBadge(mpSubscription)}
      </div>
      <p className="text-xs text-slate-400 mt-1 mb-3">
        O aluno recebe um convite no app para assinar e pagar pelo Mercado Pago.
      </p>
      <div className="space-y-3">
        <select
          className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm text-white"
          value={planId}
          onChange={(e) => { setPlanId(e.target.value); setOptionId('') }}
        >
          <option value="">Selecione um plano...</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm text-white"
          value={optionId}
          onChange={(e) => setOptionId(e.target.value)}
          disabled={!planId}
        >
          <option value="">Selecione a periodicidade...</option>
          {planOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {PERIODICITY_LABELS[o.periodicity]} · {formatCurrency(o.price)}
            </option>
          ))}
        </select>
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-400 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">{success}</p>
        )}
        <Button size="sm" variant="primary" loading={pending} disabled={!planId || !optionId} onClick={handleRecommend}>
          Enviar indicação
        </Button>
      </div>
    </Card>
  )
}
