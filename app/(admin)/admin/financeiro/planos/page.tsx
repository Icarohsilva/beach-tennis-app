// app/(admin)/admin/financeiro/planos/page.tsx
import { createAdminClient, getCurrentOrgId, requireOwner } from '@/lib/supabase/server'
import { PlansManager } from '../PlansManager'
import { FinanceiroSubnav } from '../FinanceiroSubnav'
import { SalesSettingsCard } from './SalesSettingsCard'
import type { SubscriptionPlan, PlanBillingOption } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'

export default async function PlanosPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  await requireOwner()
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const { data: plansRaw } = await adminClient
    .from('subscription_plans')
    .select('*')
    .eq('organization_id', orgId)
    .order('classes_per_week', { ascending: true })
  const plans: SubscriptionPlan[] = plansRaw ?? []

  const { data: optionsRaw } = await adminClient
    .from('plan_billing_options')
    .select('*')
    .eq('organization_id', orgId)
  const options: PlanBillingOption[] = optionsRaw ?? []

  // Settings de venda avulsa/day use (key/value por academia).
  const { data: settingsRaw } = await adminClient
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['single_class_price', 'single_class_sale_enabled', 'day_use_price', 'day_use_sale_enabled'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Planos e preços</h1>
        <p className="text-slate-400 text-sm mt-1">Periodicidades, aula avulsa e day use</p>
      </div>
      <FinanceiroSubnav />

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Planos</h2>
        <PlansManager plans={plans} options={options} />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Venda avulsa</h2>
        <SalesSettingsCard
          initial={{
            single_class_price: parseFloat(settings.single_class_price ?? '0') || 0,
            single_class_sale_enabled: settings.single_class_sale_enabled === 'true',
            day_use_price: parseFloat(settings.day_use_price ?? '0') || 0,
            day_use_sale_enabled: settings.day_use_sale_enabled === 'true',
          }}
        />
      </section>
    </div>
  )
}
