import { describe, it, expect } from 'vitest'
import {
  splitWithWallet,
  walletCoversAll,
  walletReasonLabel,
  formatWalletCents,
} from './wallet'

describe('splitWithWallet', () => {
  it('sem saldo, tudo vai para o gateway', () => {
    expect(splitWithWallet(4000, 0)).toEqual({ walletCents: 0, gatewayCents: 4000 })
  })

  it('saldo parcial divide e a soma fecha exata', () => {
    const s = splitWithWallet(4000, 1500)
    expect(s).toEqual({ walletCents: 1500, gatewayCents: 2500 })
    expect(s.walletCents + s.gatewayCents).toBe(4000)
  })

  it('saldo exato cobre tudo', () => {
    expect(splitWithWallet(4000, 4000)).toEqual({ walletCents: 4000, gatewayCents: 0 })
  })

  it('saldo MAIOR que o total não gera troco nem cobrança negativa', () => {
    // O erro a evitar: debitar os 10.000 do saldo, ou mandar -6.000 ao gateway.
    expect(splitWithWallet(4000, 10000)).toEqual({ walletCents: 4000, gatewayCents: 0 })
  })

  it('total zero não movimenta nada', () => {
    expect(splitWithWallet(0, 10000)).toEqual({ walletCents: 0, gatewayCents: 0 })
  })

  it('trata valor negativo como zero em vez de inverter o fluxo', () => {
    // Preço negativo é dado corrompido; devolver saldo por causa dele seria
    // transformar um bug de cadastro em dinheiro na mão do aluno.
    expect(splitWithWallet(-4000, 1000)).toEqual({ walletCents: 0, gatewayCents: 0 })
    expect(splitWithWallet(4000, -1000)).toEqual({ walletCents: 0, gatewayCents: 4000 })
  })

  it('arredonda para centavo inteiro', () => {
    expect(splitWithWallet(4000.4, 1500.6)).toEqual({ walletCents: 1501, gatewayCents: 2499 })
  })
})

describe('walletCoversAll', () => {
  it('diz quando não há checkout a abrir', () => {
    expect(walletCoversAll(4000, 4000)).toBe(true)
    expect(walletCoversAll(4000, 5000)).toBe(true)
    expect(walletCoversAll(4000, 3999)).toBe(false)
  })

  it('compra gratuita é coberta por qualquer saldo, inclusive zero', () => {
    expect(walletCoversAll(0, 0)).toBe(true)
  })
})

describe('walletReasonLabel', () => {
  it('traduz os motivos conhecidos', () => {
    expect(walletReasonLabel('dayuse_refund')).toBe('Estorno de day use')
    expect(walletReasonLabel('class_credits')).toBe('Compra de créditos de aula')
  })

  it('motivo novo não vaza slug cru para o extrato do aluno', () => {
    expect(walletReasonLabel('algo_que_ainda_nao_existe')).toBe('Movimentação')
  })
})

describe('formatWalletCents', () => {
  it('formata crédito e débito', () => {
    expect(formatWalletCents(4000)).toBe('R$ 40,00')
    expect(formatWalletCents(-2500)).toBe('-R$ 25,00')
    expect(formatWalletCents(0)).toBe('R$ 0,00')
  })
})
