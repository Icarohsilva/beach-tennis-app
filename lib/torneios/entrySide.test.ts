// lib/torneios/entrySide.test.ts
import { describe, it, expect } from 'vitest'
import { sideOfEntry, chargeFor, entryOwedCents, entryPaidCents, entryPaymentSummary, type PayableEntry } from './entrySide'

function entry(overrides: Partial<PayableEntry> = {}): PayableEntry {
  return {
    player_id: 'p1',
    partner_id: 'p2',
    payment_status: 'pending',
    discount_pct: 0,
    final_price_cents: 6000,
    receipt_url: null,
    partner_payment_status: 'pending',
    partner_discount_pct: 0,
    partner_final_price_cents: 6000,
    partner_receipt_url: null,
    ...overrides,
  }
}

describe('sideOfEntry', () => {
  it('titular -> player, parceiro -> partner, estranho -> null', () => {
    const e = entry()
    expect(sideOfEntry('p1', e)).toBe('player')
    expect(sideOfEntry('p2', e)).toBe('partner')
    expect(sideOfEntry('x', e)).toBeNull()
  })

  it('sem parceiro, ninguém é partner', () => {
    const e = entry({ partner_id: null })
    expect(sideOfEntry('p2', e)).toBeNull()
  })
})

describe('chargeFor', () => {
  it('devolve os campos do titular ou do parceiro, sem trocar', () => {
    const e = entry({
      payment_status: 'paid',
      final_price_cents: 5400,
      partner_payment_status: 'pending',
      partner_final_price_cents: 6000,
    })
    expect(chargeFor('player', e)).toEqual({
      paymentStatus: 'paid',
      discountPct: 0,
      finalPriceCents: 5400,
      receiptUrl: null,
    })
    expect(chargeFor('partner', e)).toEqual({
      paymentStatus: 'pending',
      discountPct: 0,
      finalPriceCents: 6000,
      receiptUrl: null,
    })
  })
})

describe('entryOwedCents / entryPaidCents — BUG C: a dupla deve a soma dos dois lados', () => {
  it('os dois pendentes: deve a soma; nada pago ainda', () => {
    const e = entry({ payment_status: 'pending', partner_payment_status: 'pending' })
    expect(entryOwedCents(e)).toBe(12000)
    expect(entryPaidCents(e)).toBe(0)
  })

  it('titular pago, parceiro pendente: deve só a parte do parceiro', () => {
    const e = entry({ payment_status: 'paid', partner_payment_status: 'pending' })
    expect(entryOwedCents(e)).toBe(6000)
    expect(entryPaidCents(e)).toBe(6000)
  })

  it('sem parceiro: só o titular conta', () => {
    const e = entry({ partner_id: null, partner_payment_status: null, payment_status: 'pending' })
    expect(entryOwedCents(e)).toBe(6000)
  })

  it('linha legada (partner_payment_status nulo) não conta como dívida do parceiro', () => {
    const e = entry({ partner_payment_status: null, partner_final_price_cents: 0 })
    expect(entryOwedCents(e)).toBe(6000) // só o titular pendente
    expect(entryPaidCents(e)).toBe(0)
  })
})

describe('entryPaymentSummary', () => {
  it('titular pago + parceiro pendente = partial — o estado hoje invisível', () => {
    const e = entry({ payment_status: 'paid', partner_payment_status: 'pending' })
    expect(entryPaymentSummary(e)).toBe('partial')
  })

  it('os dois pagos = paid; os dois pendentes = pending', () => {
    expect(entryPaymentSummary(entry({ payment_status: 'paid', partner_payment_status: 'paid' }))).toBe('paid')
    expect(entryPaymentSummary(entry({ payment_status: 'pending', partner_payment_status: 'pending' }))).toBe(
      'pending',
    )
  })

  it('sem parceiro, o resumo é só o do titular', () => {
    expect(entryPaymentSummary(entry({ partner_id: null, payment_status: 'free' }))).toBe('free')
  })

  it('linha legada (partner_payment_status nulo) não vira partial', () => {
    expect(entryPaymentSummary(entry({ payment_status: 'paid', partner_payment_status: null }))).toBe('paid')
  })
})
