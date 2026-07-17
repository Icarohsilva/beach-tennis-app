// "Tem plano ativo?" isolado num único ponto — extraído depois que o mesmo
// bloco de 6 linhas apareceu em 3 call sites (classDebt, enrollStudentInClass,
// bookSession) e uma 4ª cópia (addStudentToSession, Task 12) estava prestes a
// repetir. Aceita um client injetável para reusar a mesma instância do caller
// e para ser testável com o padrão de stub já usado em classDebt.test.ts.
import { isSubscriptionCurrent } from './periodicity'
import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * 'active' com período vencido NÃO conta — mesmo critério em toda a spec
 * (docs/superpowers/specs/2026-07-16-regras-acesso-credito-design.md §1).
 */
export async function hasActiveSubscriptionPlan(
  client: AdminClient,
  studentId: string,
  orgId: string,
): Promise<boolean> {
  const { data: sub } = await client
    .from('student_subscriptions')
    .select('gateway, current_period_end')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  return !!sub && isSubscriptionCurrent(sub as { gateway: string; current_period_end: string | null }, new Date())
}
