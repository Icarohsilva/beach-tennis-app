import { describe, it, expect } from 'vitest'
import {
  entryChargeHint,
  isEntryCharged,
  resolveEntryCharge,
} from './entryCharge'

const PAGO = { entryPriceCents: 6000, pixKey: null, hasMpToken: false }

describe('resolveEntryCharge', () => {
  it('Mercado Pago conectado cobra, mesmo SEM chave PIX', () => {
    // O defeito relatado: a arena tinha o gateway ligado, definia R$ 60, deixava
    // a chave PIX vazia — e toda inscrição nascia `free`.
    expect(resolveEntryCharge({ ...PAGO, hasMpToken: true }))
      .toEqual({ charged: true, method: 'mercadopago' })
  })

  it('sem gateway, a chave PIX do torneio cobra', () => {
    expect(resolveEntryCharge({ ...PAGO, pixKey: 'arena@pix.com' }))
      .toEqual({ charged: true, method: 'pix_manual' })
  })

  it('o gateway vence a chave PIX: confirma sozinho', () => {
    expect(resolveEntryCharge({ ...PAGO, pixKey: 'arena@pix.com', hasMpToken: true }).method)
      .toBe('mercadopago')
  })

  it('preço sem nenhuma forma online é acerto na arena — nunca gratuito', () => {
    // A leitura que não dá para consertar depois: o atleta já entrou sem pagar.
    expect(resolveEntryCharge(PAGO)).toEqual({ charged: true, method: 'on_site' })
  })

  it('chave em branco não conta como chave', () => {
    expect(resolveEntryCharge({ ...PAGO, pixKey: '   ' }).method).toBe('on_site')
  })

  it('sem preço é gratuito de verdade, com ou sem gateway', () => {
    expect(resolveEntryCharge({ entryPriceCents: 0, pixKey: 'x', hasMpToken: true }))
      .toEqual({ charged: false, method: 'free' })
    expect(resolveEntryCharge({ entryPriceCents: null, pixKey: null, hasMpToken: false }))
      .toEqual({ charged: false, method: 'free' })
  })

  it('isEntryCharged é o mesmo sim/não', () => {
    expect(isEntryCharged({ ...PAGO, hasMpToken: true })).toBe(true)
    expect(isEntryCharged({ ...PAGO, entryPriceCents: 0 })).toBe(false)
  })
})

describe('entryChargeHint', () => {
  it('com gateway, diz que a chave PIX não é necessária', () => {
    const hint = entryChargeHint({ ...PAGO, hasMpToken: true })
    expect(hint).toContain('Mercado Pago')
    expect(hint).toContain('não é necessária')
  })

  it('sem forma online, avisa que o valor é acertado na arena', () => {
    expect(entryChargeHint(PAGO)).toContain('acertado na arena')
  })

  it('sem valor, diz que é gratuito', () => {
    expect(entryChargeHint({ ...PAGO, entryPriceCents: 0 })).toContain('gratuita')
  })
})
