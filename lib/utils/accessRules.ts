import { isMissedCheckinBlocked } from '@/lib/checkin/missedCheckins'
import type { CheckinPartner } from '@/types'

/** Como o aluno entra na aula e o que isso consome. */
export type AccessGrant =
  | 'partner' // Wellhub/TotalPass — não consome nada, isento de cota
  | 'plan' // assinatura vigente, dentro da cota
  | 'credit' // debita 1 crédito na reserva
  | 'debt' // entra; pendência nasce se houver presença

export type AccessDenial =
  | 'blocked_by_debt'
  | 'blocked_by_missed_checkins'
  | 'quota_exhausted'
  | 'daily_cap'

export type AccessDecision = { grant: AccessGrant } | { denied: AccessDenial }

export interface AccessInput {
  partner: CheckinPartner | null
  /** status='active' E período vigente (isSubscriptionCurrent). Ver spec §1. */
  hasActivePlan: boolean
  creditsBalance: number
  /**
   * payments pendente com session_id não-nulo E missed_checkin = false.
   * A pendência de check-in tem regra própria (openMissedCheckins) e não entra aqui,
   * senão a mesma falta bloquearia por dois caminhos. Ver spec §4.
   */
  hasOpenDebt: boolean
  /** missed_checkins com status='open' do aluno nesta academia. */
  openMissedCheckins: number
  /** system_settings.missed_checkin_block_limit. 0 = regra desligada. */
  missedCheckinBlockLimit: number
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
 * A dívida bloqueia ANTES de tudo, inclusive quem tem plano. Em seguida vem a
 * pendência de check-in, e só depois o parceiro, que é isento da cota e do teto:
 * quem tem Wellhub e plano ao mesmo tempo, o Wellhub prevalece (spec de cota §4).
 *
 * A pendência de check-in tem que ser avaliada ANTES do grant de parceiro, e não
 * junto da cota: o parceiro é isento de cota e de teto diário, então se a checagem
 * ficasse lá embaixo ela nunca rodaria para quem gera a pendência — e é justamente o
 * aluno de parceiro que a gera. Regra desligada por padrão (limite 0).
 *
 * O teto diário é avaliado ANTES da cota porque é um limite absoluto — nem
 * crédito comprado o compra. Sem essa ordem os eixos se sobreporiam quando o
 * teto estoura com cota ainda disponível.
 *
 * `addStudentToSession` (admin adiciona aluno manualmente numa sessão) passa
 * por aqui como qualquer outro caller — dívida continua sempre ignorada
 * (`hasOpenDebt: false` fixo), mas cota e teto diário agora valem de
 * verdade, com um `force: true` que o admin usa pra furar essa negação
 * especificamente quando decide adicionar mesmo assim.
 */
export function resolveClassAccess(input: AccessInput): AccessDecision {
  if (input.hasOpenDebt) return { denied: 'blocked_by_debt' }
  if (isMissedCheckinBlocked(input.openMissedCheckins, input.missedCheckinBlockLimit)) {
    return { denied: 'blocked_by_missed_checkins' }
  }
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
