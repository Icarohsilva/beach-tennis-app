'use server'
// app/(admin)/financeiro/adminActions.ts
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { PERIODICITIES } from '@/lib/billing/periodicity'
import type { Periodicity } from '@/types'

async function assertAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const orgId = await getActiveOrgId()
  if (!orgId) throw new Error('Academia ativa não encontrada.')

  const adminClient = createAdminClient()
  // Papel é por-academia: vem da membership da academia ativa.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (membership?.role !== 'admin') throw new Error('Sem permissão.')
  return { adminClient, orgId }
}

export async function togglePlanActive(
  planId: string,
  isActive: boolean,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()
    const { error } = await adminClient
      .from('subscription_plans')
      .update({ is_active: isActive })
      .eq('id', planId)
      .eq('organization_id', orgId)

    if (error) return { error: 'Erro ao atualizar plano.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export interface CreatePlanData {
  name: string
  description?: string
  classes_per_week: number
  cycle: 'weekly' | 'monthly'
  max_classes_per_day: number
  refund_on_late_cancel: boolean
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string; planId?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
    if (data.cycle !== 'weekly' && data.cycle !== 'monthly') {
      return { error: 'Ciclo da cota inválido.' }
    }
    if (!Number.isInteger(data.max_classes_per_day) || data.max_classes_per_day <= 0) {
      return { error: 'Máximo de aulas por dia deve ser um número inteiro positivo.' }
    }

    const { data: plan, error } = await adminClient
      .from('subscription_plans')
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        classes_per_week: data.classes_per_week,
        cycle: data.cycle,
        max_classes_per_day: data.max_classes_per_day,
        refund_on_late_cancel: data.refund_on_late_cancel,
        is_active: true,
        organization_id: orgId,
      })
      .select('id')
      .single()

    if (error || !plan) return { error: error?.message ?? 'Erro ao criar plano.' }
    revalidatePath('/admin/financeiro/planos')
    return { planId: plan.id as string }
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// Liga/desliga e precifica uma periodicidade do plano (upsert por plan+periodicity).
export async function saveBillingOption(
  planId: string,
  periodicity: Periodicity,
  price: number,
  isEnabled: boolean,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (!PERIODICITIES.includes(periodicity)) return { error: 'Periodicidade inválida.' }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return { error: 'Preço inválido.' }
    }
    if (isEnabled && price <= 0) return { error: 'Defina um preço para habilitar a periodicidade.' }

    // Plano precisa ser da academia ativa (adminClient bypassa RLS).
    const { data: plan } = await adminClient
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .eq('organization_id', orgId)
      .single()
    if (!plan) return { error: 'Plano não encontrado.' }

    const { error } = await adminClient.from('plan_billing_options').upsert(
      {
        organization_id: orgId,
        plan_id: planId,
        periodicity,
        price,
        is_enabled: isEnabled,
      },
      { onConflict: 'plan_id,periodicity' },
    )
    if (error) return { error: 'Erro ao salvar a periodicidade.' }
    revalidatePath('/admin/financeiro/planos')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

// Preço/toggle de aula avulsa e day use (system_settings key/value por academia).
export interface SalesSettingsData {
  single_class_price: number
  single_class_sale_enabled: boolean
  day_use_price: number
  day_use_sale_enabled: boolean
}

export async function updateSalesSettings(data: SalesSettingsData): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (data.single_class_price < 0 || data.day_use_price < 0) return { error: 'Preço inválido.' }
    if (data.single_class_sale_enabled && data.single_class_price <= 0) {
      return { error: 'Defina o preço da aula avulsa para ativar a venda.' }
    }
    if (data.day_use_sale_enabled && data.day_use_price <= 0) {
      return { error: 'Defina o preço do day use para ativar a venda.' }
    }

    const rows = [
      { organization_id: orgId, key: 'single_class_price', value: String(data.single_class_price) },
      { organization_id: orgId, key: 'single_class_sale_enabled', value: String(data.single_class_sale_enabled) },
      { organization_id: orgId, key: 'day_use_price', value: String(data.day_use_price) },
      { organization_id: orgId, key: 'day_use_sale_enabled', value: String(data.day_use_sale_enabled) },
    ]
    const { error } = await adminClient
      .from('system_settings')
      .upsert(rows, { onConflict: 'organization_id,key' })
    if (error) return { error: 'Erro ao salvar configurações de venda.' }
    revalidatePath('/admin/financeiro/planos')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function applyDiscountAdmin(
  subscriptionId: string,
  discountPct: number,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (discountPct < 0 || discountPct > 100) {
      return { error: 'Desconto deve estar entre 0 e 100.' }
    }

    const { error } = await adminClient
      .from('student_subscriptions')
      .update({ discount_pct: discountPct })
      .eq('id', subscriptionId)
      .eq('organization_id', orgId)

    if (error) return { error: 'Erro ao aplicar desconto.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
