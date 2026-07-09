// app/(dashboard)/perfil/page.tsx
import { createClient, createAdminClient, getActiveMembership, getActiveOrgId } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SubscriptionCard } from '@/features/financeiro/SubscriptionCard'
import { PaymentHistory } from '@/features/financeiro/PaymentHistory'
import { MedicalForm } from '@/features/perfil/MedicalForm'
import { GenderForm } from '@/features/perfil/GenderForm'
import { PersonalDataForm } from '@/features/perfil/PersonalDataForm'
import { AccountSecurityForm } from '@/features/perfil/AccountSecurityForm'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { DependentsSection } from '@/features/aulas/DependentsSection'
import { SelfPartnerForm } from '@/features/checkin/SelfPartnerForm'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatCard } from '@/components/ui/StatCard'
import type { StudentSubscription, SubscriptionPlan, Payment, StudentLevel } from '@/types'

export default async function PerfilPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()

  // Identidade (full_name) vem de profiles; campos por-academia (credits_balance,
  // payment_type, level, is_dependent) vêm da membership da academia ativa.
  const { data: identity } = await adminClient
    .from('profiles')
    .select('full_name, gender, phone')
    .eq('id', user.id)
    .single()

  const membership = await getActiveMembership()
  const profile = membership
    ? {
        full_name: identity?.full_name ?? null,
        credits_balance: membership.credits_balance,
        payment_type: membership.payment_type,
        level: membership.level,
        is_dependent: membership.is_dependent,
      }
    : null

  // Fetch dependents (only for non-dependent guardians). Os dependentes têm
  // membership na MESMA academia ativa — filtra por organization_id.
  const { data: dependentMembersRaw } = !profile?.is_dependent
    ? await adminClient
        .from('memberships')
        .select('user_id, level')
        .eq('parent_id', user.id)
        .eq('organization_id', orgId)
        .eq('is_dependent', true)
    : { data: [] }

  const dependentMembers = (dependentMembersRaw ?? []) as { user_id: string; level: StudentLevel }[]
  const dependentIds = dependentMembers.map((d) => d.user_id)

  const { data: dependentNamesRaw } = dependentIds.length > 0
    ? await adminClient
        .from('profiles')
        .select('id, full_name')
        .in('id', dependentIds)
    : { data: [] }

  const nameById = new Map<string, string>(
    ((dependentNamesRaw ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
  )
  const dependentsRaw = dependentMembers.map((d) => ({
    id: d.user_id,
    full_name: nameById.get(d.user_id) ?? '',
    level: d.level,
  }))

  const dependents = dependentsRaw as { id: string; full_name: string; level: StudentLevel }[]

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
    .eq('organization_id', orgId)
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
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50)

  const payments: Payment[] = paymentsRaw ?? []

  // Fetch credit transactions (refunded credits available to use)
  const { data: creditTransactionsRaw } = await adminClient
    .from('credit_transactions')
    .select('id, type, amount, reason, created_at, expires_at')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
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

  const currentPartner =
    profile?.payment_type === 'wellhub' || profile?.payment_type === 'totalpass'
      ? profile.payment_type
      : null
  const currentPartnerId =
    currentPartner === 'wellhub'
      ? (membership?.wellhub_id ?? null)
      : currentPartner === 'totalpass'
        ? (membership?.totalpass_id ?? null)
        : null
  // Mensalista ativo ⇒ trava o autoatendimento (subscription já carregada acima).
  const isActiveSubscriber = subscription?.status === 'active'

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Perfil</h1>
        {profile?.full_name && (
          <p className="text-slate-400 text-sm mt-0.5">{profile.full_name}</p>
        )}
      </div>

      {/* Dados pessoais */}
      <section>
        <SectionHeader title="Dados pessoais" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <PersonalDataForm
            initial={{
              full_name: identity?.full_name ?? '',
              phone: identity?.phone ?? null,
              birth_date: medicalProfile?.birth_date ?? null,
            }}
          />
        </div>
      </section>

      {/* Conta e segurança */}
      <section>
        <SectionHeader title="Conta e segurança" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-4">
            Altere seu email de acesso ou defina uma nova senha. A troca de email exige
            confirmação por um link enviado ao novo endereço.
          </p>
          <AccountSecurityForm currentEmail={user.email ?? ''} />
        </div>
      </section>

      {/* Stats: Créditos */}
      {!isWellhubOrTotalpass && (
        <div className="grid grid-cols-1 gap-3">
          <StatCard label="Créditos" value={profile?.credits_balance ?? 0} />
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
          <>
            <Link
              href="/financeiro"
              className="block text-sm text-brand-500 font-medium mb-3"
            >
              Ver financeiro completo (planos, pagamentos) →
            </Link>
            <SubscriptionCard
              subscription={subscription}
              plan={plan}
              creditsBalance={profile?.credits_balance ?? 0}
            />
          </>
        )}
      </section>

      {/* Acesso por parceiro (autoatendimento de ID) — não para dependentes */}
      {!profile?.is_dependent && (
        <section>
          <SectionHeader title="Acesso por parceiro" />
          <div className="bg-surface-card border border-surface-border rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-4">
              Informe seu ID do Wellhub ou TotalPass para registrar seus check-ins automaticamente.
            </p>
            <SelfPartnerForm
              currentPartner={currentPartner}
              currentPartnerId={currentPartnerId}
              isActiveSubscriber={isActiveSubscriber}
            />
          </div>
        </section>
      )}

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

      {/* Gênero (identidade) — usado em torneios por categoria */}
      <section>
        <SectionHeader title="Gênero" />
        <div className="bg-surface-card border border-surface-border rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-4">
            Usado para inscrição em torneios das categorias masculino/feminino/misto.
          </p>
          <GenderForm current={(identity?.gender ?? null) as 'M' | 'F' | null} />
        </div>
      </section>

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
