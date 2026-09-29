import { describe, it, expect } from 'vitest'
import {
  isDayUsePartner,
  parseAcceptedPartners,
  partnerOptionsFor,
  serializeAcceptedPartners,
} from './partnerCheckin'

describe('parseAcceptedPartners / serializeAcceptedPartners', () => {
  it('lê a configuração salva, ignorando lixo e repetição, na ordem fixa', () => {
    expect(parseAcceptedPartners('totalpass, WELLHUB,gympass,totalpass')).toEqual(['wellhub', 'totalpass'])
    expect(parseAcceptedPartners('')).toEqual([])
    expect(parseAcceptedPartners(undefined)).toEqual([])
  })

  it('grava só parceiro conhecido', () => {
    expect(serializeAcceptedPartners(['totalpass', 'x', 'wellhub'])).toBe('wellhub,totalpass')
    expect(serializeAcceptedPartners([])).toBe('')
  })
})

describe('partnerOptionsFor', () => {
  it('oferece os parceiros aceitos só em day use pago', () => {
    expect(partnerOptionsFor({ priceCents: 3000, accepted: ['wellhub'] })).toEqual(['wellhub'])
    expect(partnerOptionsFor({ priceCents: 0, accepted: ['wellhub', 'totalpass'] })).toEqual([])
    expect(partnerOptionsFor({ priceCents: 3000, accepted: [] })).toEqual([])
  })
})

describe('isDayUsePartner', () => {
  it('só aceita os dois parceiros', () => {
    expect(isDayUsePartner('wellhub')).toBe(true)
    expect(isDayUsePartner('totalpass')).toBe(true)
    expect(isDayUsePartner('gympass')).toBe(false)
    expect(isDayUsePartner(null)).toBe(false)
  })
})
