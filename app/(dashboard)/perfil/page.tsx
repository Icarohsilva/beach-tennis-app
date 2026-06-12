// app/(dashboard)/perfil/page.tsx
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SubscriptionCard } from '@/features/financeiro/SubscriptionCard'
import { PaymentHistory } from '@/features/financeiro/PaymentHistory'
import { MedicalForm } from '@/features/perfil/MedicalForm'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { DependentsSection } from '@/features/aulas/DependentsSection'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatCard } from '@/components/ui/StatCard'
import type { StudentSubscription, SubscriptionPlan, Payment, StudentLevel } from '@/types'

export default async function PerfilPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // Fetch profile for credits_balance, payment_type, level, and is_dependent flag
  const { data: profile } = await adminClient
    .from('profiles')
    .select('credits_balance, payment_type, full_name, is_dependent, level')
    .eq('id', user.id)
    .single()

  // Fetch dependents (only for non-dependent guardians)
  const { data: dependentsRaw } = !profile?.is_dependent
    ? await adminClient
        .from('profiles')
        .select('id, full_name, level')
        .eq('parent_id', user.id)
        .eq('is_dependent', true)
    : { data: [] }

  const dependents = (dependentsRaw ?? []) as { id: string; full_name: string; level: StudentLevel }[]

  const { data: medicalProfile } = await adminClient
    .from('medical_profiles')
    .select('birth_date, blood_type, emergency_name, emergency_phone, health_notes')
    .eq('profile_id', user.id)
    .maybeSingle()

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

  // Fetch payments ordered by created_at desc
  const { data: paymentsRaw } = await adminClient
    .from('payments')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const payments: Payment[] = paymentsRaw ?? []

  // Fetch credit transactions (refunded credits available to use)
  const { data: creditTransactionsRaw } = await adminClient
    .from('credit_transactions')
    .select('id, type, amount, reason, created_at, expires_at')
    .eq('student_id', user.id)
    .eq('type', 'refunded')
    .gt('amount', 0)
    .order('created_at', { ascending: false })
    .limit(20)

  const creditTransactions = (creditTransactionsRaw ?? []) as {
    id: string
    type: string
    amount: number
    reason: string
    created_at: string
    expires_at: string | null
  }[]

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

      {/* Stats: Créditos + Nível */}
      {!isWellhubOrTotalpass && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Créditos" value={profile?.credits_balance ?? 0} />
          <StatCard label="Nível" value={(profile?.level ?? '—').toUpperCase()} />
        </div>
      )}

      {/* Plano Ativo */}
      <section>
        <SectionHeader title="Plano Ativo" />
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

      {/* Histórico de Créditos Extras */}
      {!isWellhubOrTotalpass && creditTransactions.length > 0 && (
        <section>
          <SectionHeader title="Meus Créditos" />
          <div className="space-y-2">
            {creditTransactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-card border border-surface-border rounded-xl text-sm"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{t.reason}</p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {new Date(t.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-green-400 font-semibold">+{t.amount}</p>
                  {t.expires_at ? (
                    <p className="text-xs text-slate-500">
                      Expira {new Date(t.expires_at).toLocaleDateString('pt-BR')}
                    </p>
                  ) : (
                    <p className="text-xs text-green-500">Sem vencimento</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Histórico de Pagamentos */}
      {!isWellhubOrTotalpass && (
        <section>
          <SectionHeader title="Histórico de Pagamentos" />
          <PaymentHistory payments={payments} />
        </section>
      )}

      {/* Dependentes (apenas para responsáveis não-dependentes) */}
      {!profile?.is_dependent && (
        <section>
          <SectionHeader title="Dependentes (Kids)" />
          <div className="bg-surface-card border border-surface-border rounded-xl p-4">
            <DependentsSection initialDependents={dependents} />
          </div>
        </section>
      )}

      {/* Ficha Médica */}
      <section>
        <SectionHeader title="Ficha Médica" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-4">
            Informações de saúde para uso em caso de emergência na quadra. Visível apenas para você e o professor.
          </p>
          <MedicalForm initial={medicalProfile ?? null} />
        </div>
      </section>

      {/* Sair */}
      <section className="pb-4">
        <LogoutButton className="w-full text-center text-sm text-red-400 hover:text-red-300 py-3 border border-red-900/40 rounded-xl transition-colors">
          Sair do aplicativo
        </LogoutButton>
      </section>
    </div>
  )
}
