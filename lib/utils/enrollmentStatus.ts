import type { CheckinPartner } from '@/types'

// Puro: classifica como o aluno fixo entra na grade. A reserva só acontece pra
// 'elegivel' (spec 2026-07-21 §1). 'a_confirmar' = Wellhub/TotalPass declarado
// mas ainda não confirmado — exibição honesta, NÃO reserva.
export type EnrollmentStatus = 'elegivel' | 'a_confirmar' | 'sem_plano'

export interface EnrollmentInput {
  partner: CheckinPartner | null
  pendingPartner: CheckinPartner | null
  hasActivePlan: boolean
}

export function classifyEnrollment(input: EnrollmentInput): EnrollmentStatus {
  if (input.partner || input.hasActivePlan) return 'elegivel'
  if (input.pendingPartner) return 'a_confirmar'
  return 'sem_plano'
}
