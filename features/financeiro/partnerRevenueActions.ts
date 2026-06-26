'use server'
// features/financeiro/partnerRevenueActions.ts
// Receita de check-in de parceiro (Wellhub/TotalPass) calculada na hora.
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { CheckinPartner } from '@/types'
import { getMonthWindow } from '@/lib/utils/monthWindow'
import {
  computePartnerRevenue,
  type PartnerRates,
  type PartnerStudentMonth,
  type PartnerRevenue,
} from '@/lib/checkin/partnerRevenue'

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

/** Lê os valores por check-in da academia ativa; default 0 para parceiro sem linha. */
export async function getPartnerCheckinRates(): Promise<PartnerRates> {
  const { adminClient, orgId } = await assertAdmin()
  const { data } = await adminClient
    .from('partner_checkin_rates')
    .select('partner, value')
    .eq('organization_id', orgId)

  const rates: PartnerRates = { wellhub: 0, totalpass: 0 }
  for (const row of (data ?? []) as { partner: CheckinPartner; value: number }[]) {
    rates[row.partner] = Number(row.value)
  }
  return rates
}

/** Define o valor por check-in de um parceiro (upsert). Admin-only. value em reais ≥ 0. */
export async function setPartnerCheckinRate(
  partner: CheckinPartner,
  value: number,
): Promise<{ error?: string }> {
  try {
    const { adminClient, orgId } = await assertAdmin()

    if (partner !== 'wellhub' && partner !== 'totalpass') {
      return { error: 'Parceiro inválido.' }
    }
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
      return { error: 'Valor inválido.' }
    }

    const { error } = await adminClient.from('partner_checkin_rates').upsert(
      {
        organization_id: orgId,
        partner,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,partner' },
    )

    if (error) return { error: 'Erro ao salvar valor do parceiro.' }
    revalidatePath('/admin/financeiro')
    return {}
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'Erro desconhecido.' }
  }
}

/**
 * Receita de parceiro do mês corrente, calculada na hora. Carrega todas as
 * memberships de parceiro da academia (INCLUINDO dependentes), conta os check-ins
 * do mês de cada uma e aplica computePartnerRevenue com os valores atuais.
 */
export async function getPartnerRevenueThisMonth(): Promise<PartnerRevenue> {
  const { adminClient, orgId } = await assertAdmin()

  // Memberships de parceiro da academia ativa. NÃO filtrar is_dependent:
  // dependentes de parceiro contam no financeiro igual a alunos normais.
  const { data: memberships } = await adminClient
    .from('memberships')
    .select('user_id, payment_type, monthly_checkin_target')
    .eq('organization_id', orgId)
    .in('payment_type', ['wellhub', 'totalpass'])

  const { from, to } = getMonthWindow(new Date())
  const students: PartnerStudentMonth[] = []

  for (const m of (memberships ?? []) as {
    user_id: string
    payment_type: CheckinPartner
    monthly_checkin_target: number
  }[]) {
    const { count } = await adminClient
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('student_id', m.user_id)
      .gte('checkin_date', from)
      .lte('checkin_date', to)

    students.push({
      partner: m.payment_type,
      checkinsThisMonth: count ?? 0,
      monthlyTarget: m.monthly_checkin_target ?? 0,
    })
  }

  const rates = await getPartnerCheckinRates()
  return computePartnerRevenue(students, rates)
}
