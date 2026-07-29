// features/aulas/quotaBudget.ts
// Orçamento de cota compartilhado entre fixas e avulsas — usado tanto pela
// geração semanal (reconcileAllActiveEnrollments) quanto pela matrícula nova
// (enrollStudentInClass), pra não duplicar a mesma conta em dois lugares (a
// duplicação já causou um bug real: ver commit 5786aaa).
import type { createAdminClient } from '@/lib/supabase/server'
import { getQuotaSnapshot } from './quotaUsage'
import type { PlanQuota } from '@/lib/utils/classQuota'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * `quotaEnforced` e `plan` já resolvidos pelo chamador — cada um tem sua
 * própria forma de buscar isso (a geração semanal cacheia isQuotaEnforced por
 * academia; a matrícula reusa um plano já buscado por outra checagem). Esta
 * função só decide "vale a pena olhar a cota?" e, se sim, faz a única query
 * que realmente precisa ser feita (getQuotaSnapshot).
 */
export async function computeQuotaBudget(
  client: AdminClient,
  studentId: string,
  orgId: string,
  quotaEnforced: boolean,
  plan: PlanQuota | null,
  partner: string | null,
  targetDate: string,
): Promise<number | null> {
  if (partner || !quotaEnforced || !plan) return null
  const snapshot = await getQuotaSnapshot(client, studentId, orgId, plan, targetDate)
  return snapshot.remaining
}
