'use server'
// app/(admin)/financeiro/adminActions.ts
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function assertAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado.')

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Sem permissão.')
  return adminClient
}

export async function togglePlanActive(
  planId: string,
  isActive: boolean,
): Promise<{ error?: string }> {
  try {
    const adminClient = await assertAdmin()
    const { error } = await adminClient
      .from('subscription_plans')
      .update({ is_active: isActive })
      .eq('id', planId)

    if (error) return { error: 'Erro ao atualizar plano.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

export async function updatePlanPrice(
  planId: string,
  prices: { price_monthly?: number; price_quarterly?: number; price_annual?: number },
): Promise<{ error?: string }> {
  try {
    const adminClient = await assertAdmin()

    // Validate
    for (const [key, val] of Object.entries(prices)) {
      if (val !== undefined && (typeof val !== 'number' || val < 0)) {
        return { error: `Valor inválido para ${key}.` }
      }
    }

    const { error } = await adminClient
      .from('subscription_plans')
      .update(prices)
      .eq('id', planId)

    if (error) return { error: 'Erro ao atualizar preço.' }
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
  credits_per_month: number
  price_monthly: number
  price_quarterly: number
  price_annual: number
}

export async function createPlan(data: CreatePlanData): Promise<{ error?: string }> {
  try {
    const adminClient = await assertAdmin()

    if (!data.name.trim()) return { error: 'Nome é obrigatório.' }
    if (data.credits_per_month < 1) return { error: 'Créditos por mês deve ser ≥ 1.' }
    if (data.price_monthly < 0 || data.price_quarterly < 0 || data.price_annual < 0) {
      return { error: 'Preço inválido.' }
    }

    const { error } = await adminClient.from('subscription_plans').insert({
      name: data.name.trim(),
      description: data.description?.trim() || null,
      classes_per_week: data.classes_per_week,
      credits_per_month: data.credits_per_month,
      price_monthly: data.price_monthly,
      price_quarterly: data.price_quarterly,
      price_annual: data.price_annual,
      is_active: true,
    })

    if (error) return { error: error.message }
    revalidatePath('/admin/financeiro')
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
    const adminClient = await assertAdmin()

    if (discountPct < 0 || discountPct > 100) {
      return { error: 'Desconto deve estar entre 0 e 100.' }
    }

    const { error } = await adminClient
      .from('student_subscriptions')
      .update({ discount_pct: discountPct })
      .eq('id', subscriptionId)

    if (error) return { error: 'Erro ao aplicar desconto.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}
