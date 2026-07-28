import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada, isento de cota
  | 'plan' // assinatura vigente, dentro da cota
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial = 'blocked_by_debt' | 'quota_exhausted' | 'daily_cap'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

export interface AccessInput {
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /** payments pendente com session_id não-nulo. Ver spec §4. */
  hasOpenDebt: boolean
  /** system_settings.quota_enforcement_enabled da academia. */
  quotaEnforced: boolean
  /** Aulas que ainda cabem no ciclo. null = aluno sem plano. */
  quotaRemaining: number | null
  /** Reservas confirmadas do aluno na data da sessão pedida. */
  bookingsOnDate: number
  /** Teto do plano, ou o default da academia para quem não tem plano. */
  maxClassesPerDay: number
}

/**
 * Decide o acesso do aluno a uma aula. Pura: toda busca fica no caller.
 *
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano. O parceiro vem em
 * seguida e é isento da cota e do teto: quem tem Wellhub e plano ao mesmo
 * tempo, o Wellhub prevalece (spec de cota §4).
 *
 * O teto diário é avaliado ANTES da cota porque é um limite absoluto — nem
 * crédito comprado o compra. Sem essa ordem os eixos se sobreporiam quando o
 * teto estoura com cota ainda disponível.
 *
 * O admin ignora tudo isto: addStudentToSession não passa por aqui.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (input.partner) return { grant: 'partner' }

  if (input.quotaEnforced) {
    if (input.bookingsOnDate >= input.maxClassesPerDay) return { denied: 'daily_cap' }
    if (input.hasActivePlan && (input.quotaRemaining ?? 0) > 0) return { grant: 'plan' }
    if (input.creditsBalance >= 1) return { grant: 'credit' }
    // Plano exausto não vira dívida: cobrar avulsa de quem tem plano não é o
    // que a academia quer. Quem nunca teve plano segue no caminho de baixo.
    if (input.hasActivePlan) return { denied: 'quota_exhausted' }
    return { grant: 'debt' }
  }

  if (input.hasActivePlan) return { grant: 'plan' }
  if (input.creditsBalance >= 1) return { grant: 'credit' }
  return { grant: 'debt' }
}
