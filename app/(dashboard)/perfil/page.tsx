// app/(dashboard)/perfil/page.tsx
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SubscriptionCard } from '@/features/financeiro/SubscriptionCard'
import { PlanSelector } from '@/features/financeiro/PlanSelector'
import { PaymentHistory } from '@/features/financeiro/PaymentHistory'
import type { StudentSubscription, SubscriptionPlan, Payment } from '@/types'

export default async function PerfilPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Fetch profile for credits_balance and payment_type
  const { data: profile } = await adminClient
    .from('profiles')
    .select('credits_balance, payment_type, full_name')
    .eq('id', user.id)
    .single()

  // Fetch active subscription + plan
  const { data: subscriptionRaw } = await adminClient
    .from('student_subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('student_id', user.id)
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const subscription: StudentSubscription | null = subscriptionRaw
    ? ({
        id: subscriptionRaw.id,
        student_id: subscriptionRaw.student_id,
        payer_id: subscriptionRaw.payer_id,
        plan_id: subscriptionRaw.plan_id,
        status: subscriptionRaw.status,
        starts_at: subscriptionRaw.starts_at,
        ends_at: subscriptionRaw.ends_at,
        next_billing_at: subscriptionRaw.next_billing_at,
        discount_pct: subscriptionRaw.discount_pct,
        gateway_subscription_id: subscriptionRaw.gateway_subscription_id,
      } as StudentSubscription)
    : null

  const plan: SubscriptionPlan | null = subscriptionRaw?.plan ?? null

  // Fetch available plans (for selector, when no active plan)
  const { data: availablePlans } = await adminClient
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('classes_per_week', { ascending: true })

  const plans: SubscriptionPlan[] = availablePlans ?? []

  // Fetch payments ordered by created_at desc
  const { data: paymentsRaw } = await adminClient
    .from('payments')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const payments: Payment[] = paymentsRaw ?? []

  const isWellhubOrTotalpass =
    profile?.payment_type === 'wellhub' || profile?.payment_type === 'totalpass'

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Perfil</h1>
        {profile?.full_name && (
          <p className="text-slate-400 text-sm mt-0.5">{profile.full_name}</p>
        )}
      </div>

      {/* Plano Ativo */}
      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Plano Ativo
        </h2>
        {isWellhubOrTotalpass ? (
          <div className="bg-surface-card border border-surface-border rounded-xl p-4">
            <p className="text-sm text-slate-300">
              Você acessa via{' '}
              <span className="text-brand-500 font-medium capitalize">{profile.payment_type}</span>.
              O check-in é registrado automaticamente.
            </p>
          </div>
        ) : (
          <SubscriptionCard
            subscription={subscription}
            plan={plan}
            creditsBalance={profile?.credits_balance ?? 0}
          />
        )}
      </section>

      {/* Créditos */}
      {!isWellhubOrTotalpass && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Créditos
          </h2>
          <div className="bg-surface-card border border-surface-border rounded-xl p-4 flex items-center gap-3">
            <span className="text-3xl font-bold text-brand-500">
              {profile?.credits_balance ?? 0}
            </span>
            <div>
              <p className="text-white text-sm font-medium">créditos disponíveis</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Renova todo mês com base no seu plano
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Selecionar Plano (se sem assinatura ativa e não Wellhub/TotalPass) */}
      {!isWellhubOrTotalpass && !subscription && plans.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Escolha um Plano
          </h2>
          <PlanSelector plans={plans} currentPlanId={subscription ? plan?.id : null} />
        </section>
      )}

      {/* Histórico de Pagamentos */}
      {!isWellhubOrTotalpass && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Histórico de Pagamentos
          </h2>
          <PaymentHistory payments={payments} />
        </section>
      )}
    </div>
  )
}
