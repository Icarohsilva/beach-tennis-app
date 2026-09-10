import { describe, it, expect } from 'vitest'
import {
  DAY_USE_KINDS,
  DAY_USE_KIND_LABEL,
  dayUseKindHint,
  dayUsePriceCents,
  reaisToCents,
  dayUseChargeTitle,
  formatDayUsePrice,
  dayUsePriceView,
} from './dayUseKind'

describe('DAY_USE_KIND_LABEL', () => {
  it('rotula os dois tipos que a arena usa', () => {
    expect(DAY_USE_KINDS).toEqual(['scheduled', 'open'])
    expect(DAY_USE_KIND_LABEL.scheduled).toBe('Horário marcado')
    expect(DAY_USE_KIND_LABEL.open).toBe('Livre no período')
  })

  it('explica a diferença entre reservar um horário e entrar no período', () => {
    expect(dayUseKindHint('open')).toContain('rotação')
    expect(dayUseKindHint('scheduled')).toContain('vaga é sua')
  })
})

describe('dayUsePriceCents', () => {
  it('usa o preço do slot quando ele tem preço próprio', () => {
    expect(dayUsePriceCents({ price_cents: 4500 }, 3000)).toBe(4500)
  })

  it('cai no padrão da academia quando o slot não define preço', () => {
    // É o comportamento de hoje: antes de existir preço por slot, todo day use
    // cobrava system_settings.day_use_price.
    expect(dayUsePriceCents({ price_cents: null }, 3000)).toBe(3000)
    expect(dayUsePriceCents({}, 3000)).toBe(3000)
  })

  it('respeita preço ZERO no slot em vez de tratar como ausente', () => {
    // 0 é decisão do admin ("este day use é de graça"), e um `||` no lugar do
    // `== null` faria a academia cobrar quem foi convidado sem custo.
    expect(dayUsePriceCents({ price_cents: 0 }, 3000)).toBe(0)
  })

  it('nunca devolve preço negativo herdado', () => {
    expect(dayUsePriceCents({ price_cents: null }, -100)).toBe(0)
  })
})

describe('reaisToCents', () => {
  it('converte reais em centavos aceitando vírgula', () => {
    expect(reaisToCents('40')).toBe(4000)
    expect(reaisToCents('39,90')).toBe(3990)
    expect(reaisToCents('39.90')).toBe(3990)
    expect(reaisToCents(25)).toBe(2500)
  })

  it('trata vazio e lixo como sem preço', () => {
    expect(reaisToCents('')).toBe(0)
    expect(reaisToCents(null)).toBe(0)
    expect(reaisToCents('abc')).toBe(0)
    expect(reaisToCents('-10')).toBe(0)
  })

  it('não perde centavo por ponto flutuante', () => {
    // 1.15 * 100 = 114.99999999999999 em float; sem arredondar, R$ 1,15 virava
    // R$ 1,14 na cobrança.
    expect(reaisToCents('1,15')).toBe(115)
  })
})

describe('dayUseChargeTitle', () => {
  it('põe modalidade e dia no título da cobrança', () => {
    expect(dayUseChargeTitle({ sportLabel: 'Beach Tennis', date: '2026-09-20' }))
      .toBe('Day Use Beach Tennis · 20/09')
  })

  it('funciona sem modalidade declarada', () => {
    expect(dayUseChargeTitle({ sportLabel: null, date: '2026-09-20' }))
      .toBe('Day Use · 20/09')
  })
})

describe('formatDayUsePrice', () => {
  it('formata em reais', () => {
    expect(formatDayUsePrice(4000)).toBe('R$ 40,00')
    expect(formatDayUsePrice(3990)).toBe('R$ 39,90')
  })

  it('diz Gratuito quando não há preço — o mesmo caso em que não abre checkout', () => {
    expect(formatDayUsePrice(0)).toBe('Gratuito')
  })
})

describe('dayUsePriceView', () => {
  const naArena = { defaultCents: 0, canCharge: false }
  const online = { defaultCents: 0, canCharge: true }

  it('o preço é o preço, com ou sem cobrança no app', () => {
    // O defeito relatado: o admin definia R$ 20 e TODA tela — inclusive o link
    // do aluno — dizia "Gratuito", porque a leitura de preço era condicionada a
    // conseguir cobrar dentro do app.
    expect(dayUsePriceView({ price_cents: 2000, payment_timing: 'on_booking' }, online))
      .toEqual({
        priceCents: 2000, timing: 'on_booking',
        collectedInApp: true, payOnSite: false, needsSetup: false,
      })
    expect(dayUsePriceView({ price_cents: 2000, payment_timing: 'on_site' }, online))
      .toEqual({
        priceCents: 2000, timing: 'on_site',
        collectedInApp: false, payOnSite: true, needsSetup: false,
      })
  })

  it('a escolha da academia manda, mesmo com cobrança online disponível', () => {
    // Arena com Mercado Pago ligado que cobra na porta. Antes de `payment_timing`
    // isto era deduzido da configuração e não havia como dizer "cobro na porta".
    const v = dayUsePriceView({ price_cents: 4000, payment_timing: 'on_site' }, online)
    expect(v.payOnSite).toBe(true)
    expect(v.collectedInApp).toBe(false)
  })

  it('pedir na inscrição sem como receber cai na arena e pede configuração', () => {
    const v = dayUsePriceView({ price_cents: 4000, payment_timing: 'on_booking' }, naArena)
    expect(v.timing).toBe('on_site')
    expect(v.payOnSite).toBe(true)
    expect(v.needsSetup).toBe(true)
  })

  it('timing ausente é "na arena" — o default da coluna', () => {
    expect(dayUsePriceView({ price_cents: 4000 }, online).timing).toBe('on_site')
  })

  it('preço zero segue gratuito e não "pague na arena"', () => {
    expect(dayUsePriceView({ price_cents: 0, payment_timing: 'on_booking' }, naArena))
      .toEqual({
        priceCents: 0, timing: 'on_site',
        collectedInApp: false, payOnSite: false, needsSetup: false,
      })
  })

  it('herda o padrão da academia', () => {
    const v = dayUsePriceView({ price_cents: null }, { defaultCents: 3000, canCharge: false })
    expect(v.priceCents).toBe(3000)
    expect(v.payOnSite).toBe(true)
  })
})
