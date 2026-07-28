// "Tem plano ativo?" isolado num único ponto — extraído depois que o mesmo
// bloco de 6 linhas apareceu em 3 call sites (classDebt, enrollStudentInClass,
// bookSession) e uma 4ª cópia (addStudentToSession, Task 12) estava prestes a
// repetir. Aceita um client injetável para reusar a mesma instância do caller
// e para ser testável com o padrão de stub já usado em classDebt.test.ts.
import { isSubscriptionCurrent } from './periodicity'
import type { createAdminClient } from '@/lib/supabase/server'
import type { PlanQuota } from '@/lib/utils/classQuota'

type AdminClient = ReturnType<typeof createAdminClient>

interface PlanRow {
  classes_per_week: number
  cycle: 'weekly' | 'monthly'
  max_classes_per_day: number
  refund_on_late_cancel: boolean
}

/**
 * Configuração de cota do plano vigente do aluno, ou null.
 * 'active' com período vencido NÃO conta — mesmo critério em toda a spec
 * (docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md §1).
 */
export async function getActivePlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<PlanQuota | null> {
  const { data: sub } = await client
    .from('student_subscriptions')
    .select(
      'gateway, current_period_end, subscription_plans(classes_per_week, cycle, max_classes_per_day, refund_on_late_cancel)',
    )
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  if (!sub) return null

  const row = sub as unknown as {
    gateway: string
    current_period_end: string | null
    subscription_plans: PlanRow | PlanRow[] | null
  }
  if (!isSubscriptionCurrent(row, new Date())) return null

  // PostgREST devolve o embed como objeto ou array conforme a cardinalidade.
  const plan = Array.isArray(row.subscription_plans)
    ? row.subscription_plans[0]
    : row.subscription_plans
  if (!plan) return null

  return {
    classesPerWeek: plan.classes_per_week,
    cycle: plan.cycle,
    maxClassesPerDay: plan.max_classes_per_day,
    refundOnLateCancel: plan.refund_on_late_cancel,
  }
}

/** Mantida para os call sites que só querem o sim/não. */
export async function hasActiveSubscriptionPlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<boolean> {
  return (await getActivePlan(client, studentId, orgId)) !== null
}
