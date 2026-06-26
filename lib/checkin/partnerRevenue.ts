import type { CheckinPartner } from '@/types'

export interface PartnerStudentMonth {
  partner: CheckinPartner
  checkinsThisMonth: number
  monthlyTarget: number
}

export type PartnerRates = Record<CheckinPartner, number> // reais por check-in

export interface PartnerRevenue {
  total: number // soma em reais
  perPartner: Record<CheckinPartner, number> // subtotal por parceiro
}

/**
 * Receita = Σ min(check-ins do mês, meta) × valor do parceiro.
 * Meta 0 ⇒ contribuição 0 (teto na meta). Negativos são saneados para 0.
 */
export function computePartnerRevenue(
  students: PartnerStudentMonth[],
  rates: PartnerRates,
): PartnerRevenue {
  const perPartner: Record<CheckinPartner, number> = { wellhub: 0, totalpass: 0 }

  for (const s of students) {
    const checkins = Math.max(s.checkinsThisMonth, 0)
    const target = Math.max(s.monthlyTarget, 0)
    const billable = Math.min(checkins, target)
    const rate = Math.max(rates[s.partner] ?? 0, 0)
    perPartner[s.partner] += billable * rate
  }

  return {
    total: perPartner.wellhub + perPartner.totalpass,
    perPartner,
  }
}
