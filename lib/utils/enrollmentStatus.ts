// Puro: classifica como o aluno fixo entra na grade. A reserva só acontece pra
// 'elegivel' (spec 2026-07-21 §1). 'a_confirmar' = Wellhub/TotalPass declarado
// mas ainda não confirmado — exibição honesta, NÃO reserva.
export type EnrollmentStatus = 'elegivel' | 'a_confirmar' | 'sem_plano'

export function classifyEnrollment(input: {
  partner: string | null
  pendingPartner: string | null
  hasActivePlan: boolean
}): EnrollmentStatus {
  if ((input.partner && input.partner.length > 0) || input.hasActivePlan) return 'elegivel'
  if (input.pendingPartner && input.pendingPartner.length > 0) return 'a_confirmar'
  return 'sem_plano'
}
