// features/financeiro/SubscriptionCard.tsx
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { StudentSubscription, SubscriptionPlan, SubscriptionStatus } from '@/types'

interface SubscriptionCardProps {
  subscription: StudentSubscription | null
  plan: SubscriptionPlan | null
  creditsBalance: number
}

function statusLabel(status: SubscriptionStatus): string {
  const labels: Record<SubscriptionStatus, string> = {
    active: 'Ativo',
    paused: 'Pausado',
    cancelled: 'Cancelado',
    pending_payment: 'Aguardando pagamento',
    past_due: 'Pagamento vencido',
  }
  return labels[status] ?? status
}

function statusVariant(status: SubscriptionStatus): 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success'
  if (status === 'paused' || status === 'pending_payment') return 'warning'
  return 'danger'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function SubscriptionCard({ subscription, plan, creditsBalance }: SubscriptionCardProps) {
  if (!subscription || !plan) {
    return (
      <Card>
        <p className="text-sm text-slate-400">Nenhum plano ativo.</p>
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold">{plan.name}</h3>
          {plan.description && (
            <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
          )}
        </div>
        <Badge variant={statusVariant(subscription.status)}>
          {statusLabel(subscription.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-slate-400">Aulas/semana</dt>
          <dd className="text-white font-medium">{plan.classes_per_week}x</dd>
        </div>
        <div>
          <dt className="text-slate-400">Saldo de créditos</dt>
          <dd className="text-white font-medium">{creditsBalance} crédito{creditsBalance !== 1 ? 's' : ''}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Início</dt>
          <dd className="text-white font-medium">{formatDate(subscription.starts_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Próxima cobrança</dt>
          <dd className="text-white font-medium">{formatDate(subscription.next_billing_at)}</dd>
        </div>
        {subscription.discount_pct > 0 && (
          <div className="col-span-2">
            <dt className="text-slate-400">Desconto</dt>
            <dd className="text-green-400 font-medium">{subscription.discount_pct}% de desconto</dd>
          </div>
        )}
      </dl>
    </Card>
  )
}
