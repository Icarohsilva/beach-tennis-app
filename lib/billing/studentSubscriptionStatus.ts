// lib/billing/studentSubscriptionStatus.ts
// Tradução do status de Preapproval do MP para o status da assinatura do
// ALUNO (student_subscriptions). Análogo ao mpStatus.ts (que é do billing
// SaaS academia→plataforma — enums diferentes, não misturar).
// null = sem mapeamento → o webhook NÃO altera o registro.
import type { SubscriptionStatus } from '@/types'

export function mapStudentPreapprovalStatus(
  mpStatus: string | undefined,
): SubscriptionStatus | null {
  switch (mpStatus) {
    case 'authorized':
      return 'active'
    case 'paused':
      return 'past_due'
    case 'cancelled':
      return 'cancelled'
    case 'pending':
      return 'pending_payment'
    default:
      return null
  }
}
