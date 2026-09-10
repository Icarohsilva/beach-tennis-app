import { describe, it, expect } from 'vitest'
import {
  holdMinutesFor,
  holdUntilIso,
  needsManualConfirmation,
  paymentMethodLabel,
  resolveDayUsePaymentMethod,
} from './paymentMethod'

describe('holdMinutesFor', () => {
  it('dá ao PIX manual uma janela humana, não a do webhook', () => {
    // Com os 30 min do Checkout Pro, o PIX manual perdia a vaga antes de
    // qualquer pessoa da arena olhar o comprovante.
    expect(holdMinutesFor('mercadopago')).toBe(30)
    expect(holdMinutesFor('pix_manual')).toBe(24 * 60)
  })

  it('confirmado na hora não segura nada', () => {
    expect(holdMinutesFor('free')).toBe(0)
    expect(holdMinutesFor('wallet')).toBe(0)
    // Quem paga na porta não tem prazo online a cumprir.
    expect(holdMinutesFor('on_site')).toBe(0)
  })
})

describe('holdUntilIso', () => {
  it('soma a janela do método', () => {
    expect(holdUntilIso('mercadopago', '2026-09-20T12:00:00.000Z'))
      .toBe('2026-09-20T12:30:00.000Z')
    expect(holdUntilIso('pix_manual', '2026-09-20T12:00:00.000Z'))
      .toBe('2026-09-21T12:00:00.000Z')
  })

  it('devolve null para quem já está confirmado', () => {
    // Data no passado aqui derrubaria uma reserva que ninguém deve derrubar.
    expect(holdUntilIso('free', '2026-09-20T12:00:00.000Z')).toBeNull()
    expect(holdUntilIso('wallet', '2026-09-20T12:00:00.000Z')).toBeNull()
  })
})

describe('needsManualConfirmation', () => {
  it('só o PIX manual espera gente', () => {
    expect(needsManualConfirmation('pix_manual')).toBe(true)
    expect(needsManualConfirmation('mercadopago')).toBe(false)
    expect(needsManualConfirmation('wallet')).toBe(false)
  })
})

describe('resolveDayUsePaymentMethod', () => {
  // `timing: 'on_booking'` no base porque a escolha da academia vem ANTES da
  // configuração: sem ela, toda cobrança cai em 'on_site' (o default da coluna)
  // e nenhum destes casos de gateway existiria.
  const base = {
    gatewayCents: 4000, walletCents: 0,
    hasMpToken: true, hasPixKey: true,
    timing: 'on_booking' as const,
  }

  it('a escolha da academia vence o gateway conectado', () => {
    // Arena com Mercado Pago ligado que cobra na porta: exigir pagamento online
    // aqui prendia o aluno num checkout que a arena não queria.
    expect(resolveDayUsePaymentMethod({ ...base, timing: 'on_site' })).toBe('on_site')
  })

  it('timing ausente é "na arena" — o default da coluna', () => {
    const { timing: _ignored, ...noTiming } = base
    expect(resolveDayUsePaymentMethod(noTiming)).toBe('on_site')
  })

  it('pedir pagamento na inscrição sem como receber cai na arena, não barra', () => {
    // Barrar a reserva puniria o aluno por uma configuração da academia; a tela
    // do admin é que avisa que falta conectar (dayUsePriceView.needsSetup).
    expect(resolveDayUsePaymentMethod({ ...base, hasMpToken: false, hasPixKey: false }))
      .toBe('on_site')
  })

  it('gateway conectado vence: confirma sozinho', () => {
    expect(resolveDayUsePaymentMethod(base)).toBe('mercadopago')
  })

  it('sem gateway, a chave PIX da arena ainda cobra', () => {
    // Era o furo: day use pago em arena sem Mercado Pago saía de graça.
    expect(resolveDayUsePaymentMethod({ ...base, hasMpToken: false })).toBe('pix_manual')
  })

  it('sem cobrança online, o day use é pago NA ARENA — não gratuito', () => {
    // Era daqui que saía o "Gratuito" num day use de R$ 20: sem gateway e sem
    // chave PIX, a reserva era tratada como sem preço.
    expect(resolveDayUsePaymentMethod({ ...base, hasMpToken: false, hasPixKey: false }))
      .toBe('on_site')
  })

  it('preço zero é gratuito de verdade, mesmo sem cobrança online', () => {
    expect(resolveDayUsePaymentMethod({
      gatewayCents: 0, walletCents: 0, hasMpToken: false, hasPixKey: false,
    })).toBe('free')
  })

  it('crédito cobrindo tudo dispensa cobrança', () => {
    expect(resolveDayUsePaymentMethod({ ...base, gatewayCents: 0, walletCents: 4000 }))
      .toBe('wallet')
  })

  it('day use realmente gratuito não é "wallet"', () => {
    expect(resolveDayUsePaymentMethod({ ...base, gatewayCents: 0, walletCents: 0 }))
      .toBe('free')
  })

  it('pagamento misto vai pelo gateway: só a sobra é cobrada', () => {
    expect(resolveDayUsePaymentMethod({ ...base, gatewayCents: 2500, walletCents: 1500 }))
      .toBe('mercadopago')
  })
})

describe('paymentMethodLabel', () => {
  it('fala com humano', () => {
    expect(paymentMethodLabel('pix_manual')).toContain('PIX')
    expect(paymentMethodLabel('wallet')).toContain('Crédito')
  })
})
