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
      {/* Empilha em celular. Sem isso o nome do plano encostava direto no badge
          "Aguardando pagamento" (os dois no min-content, zero folga); e só pôr
          `flex-wrap` não resolve — com `flex-1` a base é 0, então o badge nunca sai da
          linha e o nome era comprimido a ~60px, virando uma coluna de 5 linhas de uma
          palavra cada. Aparece em /financeiro e /perfil. */}
      <div className="mb-3 flex flex-col gap-2 xs:flex-row xs:items-start xs:justify-between xs:gap-3">
        <div className="min-w-0">
          <h3 className="text-white font-semibold break-words">{plan.name}</h3>
          {plan.description && (
            <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
          )}
        </div>
        <span className="shrink-0">
          <Badge variant={statusVariant(subscription.status)}>
            {statusLabel(subscription.status)}
          </Badge>
        </span>
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
