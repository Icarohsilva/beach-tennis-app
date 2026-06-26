import { describe, it, expect } from 'vitest'
import { computePartnerRevenue } from './partnerRevenue'
import type { PartnerStudentMonth, PartnerRates } from './partnerRevenue'

const rates: PartnerRates = { wellhub: 10, totalpass: 8 }

describe('computePartnerRevenue', () => {
  it('lista vazia → total 0 e subtotais 0', () => {
    expect(computePartnerRevenue([], rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('teto na meta: 15 check-ins, meta 12, valor 10 → 120 (não 150)', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 15, monthlyTarget: 12 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 120,
      perPartner: { wellhub: 120, totalpass: 0 },
    })
  })

  it('abaixo da meta: 5 check-ins, meta 12, valor 10 → 50', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 5, monthlyTarget: 12 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 50,
      perPartner: { wellhub: 50, totalpass: 0 },
    })
  })

  it('meta 0 → contribuição 0 mesmo com check-ins', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 9, monthlyTarget: 0 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('valores negativos saneados para 0', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: -3, monthlyTarget: -2 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 0,
      perPartner: { wellhub: 0, totalpass: 0 },
    })
  })

  it('mistura Wellhub + TotalPass → perPartner e total corretos', () => {
    const students: PartnerStudentMonth[] = [
      { partner: 'wellhub', checkinsThisMonth: 10, monthlyTarget: 12 },
      { partner: 'totalpass', checkinsThisMonth: 20, monthlyTarget: 12 },
      { partner: 'totalpass', checkinsThisMonth: 3, monthlyTarget: 12 },
    ]
    expect(computePartnerRevenue(students, rates)).toEqual({
      total: 220,
      perPartner: { wellhub: 100, totalpass: 120 },
    })
  })
})
