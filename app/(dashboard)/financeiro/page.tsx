// app/(dashboard)/financeiro/page.tsx
// Financeiro do aluno: meu plano, vitrine de planos, compra de aula avulsa,
// histórico. (Banner de indicação de plano ainda entra em task futura.)
import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getActiveOrgId, getActiveMembership } from '@/lib/supabase/server'
import { SubscriptionCard } from '@/features/financeiro/SubscriptionCard'
import { PaymentHistory } from '@/features/financeiro/PaymentHistory'
import { PlanStorefront } from '@/features/financeiro/PlanStorefront'
import { CancelPlanButton } from '@/features/financeiro/CancelPlanButton'
import { CheckoutReturnBanner } from '@/features/financeiro/CheckoutReturnBanner'
import { BuyCreditsCard } from '@/features/financeiro/BuyCreditsCard'
import type { Payment, PlanBillingOption, StudentSubscription, SubscriptionPlan } from '@/types'

export default async function FinanceiroAlunoPage({
  searchParams,
}: {
  searchParams: { retorno?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await getActiveOrgId()
  if (!orgId) redirect('/selecionar-academia')

  const admin = createAdminClient()
  const membership = await getActiveMembership()

  // Limpeza lazy de pendências velhas (spec §3.1: >24h sem autorizar → cancelada).
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  await admin
    .from('student_subscriptions')
    .update({ status: 'cancelled' })
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('status', 'pending_payment')
    .lt('starts_at', dayAgo)

  const { data: subRaw } = await admin
    .from('student_subscriptions')
    .select('*')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .in('status', ['active', 'past_due', 'pending_payment'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const subscription = subRaw as StudentSubscription | null

  let plan: SubscriptionPlan | null = null
  if (subscription) {
    const { data: planRaw } = await admin
      .from('subscription_plans')
      .select('*')
      .eq('id', subscription.plan_id)
      .single()
    plan = planRaw as SubscriptionPlan | null
  }

  const { data: plansRaw } = await admin
    .from('subscription_plans')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('classes_per_week', { ascending: true })
  const plans: SubscriptionPlan[] = plansRaw ?? []

  const { data: optionsRaw } = await admin
    .from('plan_billing_options')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_enabled', true)
  const options: PlanBillingOption[] = optionsRaw ?? []

  const { data: mpAccount } = await admin
    .from('org_gateway_accounts')
    .select('status')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  const mpConnected = mpAccount?.status === 'connected'

  const { data: paymentsRaw } = await admin
    .from('payments')
    .select('*')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)
  const payments: Payment[] = paymentsRaw ?? []

  const { data: salesRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled'])
  const sales = Object.fromEntries(
    ((salesRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const singleClassPrice = parseFloat(sales.single_class_price ?? '0') || 0
  const singleClassEnabled =
    sales.single_class_sale_enabled === 'true' && singleClassPrice > 0 && mpConnected

  const hasActivePlan = subscription?.status === 'active' || subscription?.status === 'past_due'

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-white">Financeiro</h1>
        <p className="text-slate-400 text-sm mt-1">Seu plano, pagamentos e contratação</p>
      </div>

      {searchParams.retorno === 'assinatura' && (
        <CheckoutReturnBanner message="Recebemos seu retorno do Mercado Pago. Assim que o pagamento for confirmado, seu plano é ativado automaticamente — isso costuma levar alguns segundos." />
      )}

      {searchParams.retorno === 'avulso' && (
        <CheckoutReturnBanner message="Recebemos seu pagamento. Os créditos entram no seu saldo assim que o Mercado Pago confirmar — normalmente em segundos." />
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Meu plano</h2>
        <SubscriptionCard
          subscription={subscription}
          plan={plan}
          creditsBalance={(membership?.credits_balance as number | undefined) ?? 0}
        />
        {hasActivePlan && <div className="mt-2"><CancelPlanButton /></div>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Planos disponíveis</h2>
        <PlanStorefront
          plans={plans}
          options={options}
          mpConnected={mpConnected}
          hasActivePlan={hasActivePlan}
        />
      </section>

      {singleClassEnabled && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Aula avulsa</h2>
          <BuyCreditsCard unitPrice={singleClassPrice} />
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Histórico de pagamentos</h2>
        <PaymentHistory payments={payments} />
      </section>
    </div>
  )
}
