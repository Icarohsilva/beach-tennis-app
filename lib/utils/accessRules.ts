import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada
  | 'plan' // assinatura vigente — não consome nada, ilimitado
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial = 'blocked_by_debt'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

export interface AccessInput {
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /** payments pendente com session_id não-nulo. Ver spec §4. */
  hasOpenDebt: boolean
}

/**
 * Decide o acesso do aluno a uma aula. Pura: toda busca fica no caller.
 *
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano: dívida trava o
 * aluno até a baixa. A única porta que ignora isso é a adição pelo admin, que
 * não passa por aqui.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (input.partner) return { grant: 'partner' }
  if (input.hasActivePlan) return { grant: 'plan' }
  if (input.creditsBalance >= 1) return { grant: 'credit' }
  return { grant: 'debt' }
}
