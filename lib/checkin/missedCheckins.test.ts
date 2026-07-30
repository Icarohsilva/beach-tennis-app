import { describe, it, expect } from 'vitest'
import {
  isMissedCheckinBlocked,
  summarizeMissedCheckins,
  buildMissedCheckinMessage,
} from './missedCheckins'
import type { MissedCheckinRow } from './missedCheckins'

function row(over: Partial<MissedCheckinRow> = {}): MissedCheckinRow {
  return { id: 'a', sessionDate: '2026-07-10', amount: 10, status: 'open', ...over }
}

describe('isMissedCheckinBlocked', () => {
  it('limite 0 (regra desligada) → nunca bloqueia, nem com muitas pendências', () => {
    expect(isMissedCheckinBlocked(9, 0)).toBe(false)
  })

  it('limite negativo → tratado como desligado', () => {
    expect(isMissedCheckinBlocked(9, -1)).toBe(false)
  })

  it('limite 3 com 2 abertas → não bloqueia', () => {
    expect(isMissedCheckinBlocked(2, 3)).toBe(false)
  })

  it('limite 3 com 3 abertas → bloqueia (o limite é atingido, não excedido)', () => {
    expect(isMissedCheckinBlocked(3, 3)).toBe(true)
  })

  it('limite 3 com 4 abertas → bloqueia', () => {
    expect(isMissedCheckinBlocked(4, 3)).toBe(true)
  })

  it('sem pendência → nunca bloqueia', () => {
    expect(isMissedCheckinBlocked(0, 1)).toBe(false)
  })
})

describe('summarizeMissedCheckins', () => {
  it('lista vazia → zerado e não bloqueado', () => {
    expect(summarizeMissedCheckins([], 3)).toEqual({
      openCount: 0,
      openAmount: 0,
      dates: [],
      blocked: false,
      untilBlock: 3,
    })
  })

  it('ignora paid e waived na contagem, no valor e nas datas', () => {
    const rows = [
      row({ id: 'a', sessionDate: '2026-07-10', amount: 10, status: 'open' }),
      row({ id: 'b', sessionDate: '2026-07-11', amount: 10, status: 'paid' }),
      row({ id: 'c', sessionDate: '2026-07-12', amount: 10, status: 'waived' }),
    ]
    expect(summarizeMissedCheckins(rows, 3)).toEqual({
      openCount: 1,
      openAmount: 10,
      dates: ['2026-07-10'],
      blocked: false,
      untilBlock: 2,
    })
  })

  it('datas saem em ordem cronológica mesmo desordenadas na entrada', () => {
    const rows = [
      row({ id: 'a', sessionDate: '2026-07-20' }),
      row({ id: 'b', sessionDate: '2026-07-05' }),
    ]
    expect(summarizeMissedCheckins(rows, 0).dates).toEqual(['2026-07-05', '2026-07-20'])
  })

  it('valores negativos saneados para 0 no total', () => {
    expect(summarizeMissedCheckins([row({ amount: -5 })], 0).openAmount).toBe(0)
  })

  it('limite atingido → blocked true e untilBlock 0', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    expect(summarizeMissedCheckins(rows, 2)).toMatchObject({ blocked: true, untilBlock: 0 })
  })

  it('regra desligada → untilBlock null e blocked false', () => {
    expect(summarizeMissedCheckins([row()], 0)).toMatchObject({ blocked: false, untilBlock: null })
  })
})

describe('buildMissedCheckinMessage', () => {
  const base = {
    studentName: 'Maria Souza Lima',
    orgName: 'Arena Sol',
    dates: ['2026-07-10', '2026-07-17'],
    amount: 20,
    blocked: false,
    payUrl: 'https://app.exemplo.com/financeiro',
  }

  it('usa só o primeiro nome e o nome da academia', () => {
    const msg = buildMissedCheckinMessage(base)
    expect(msg).toContain('Oi, Maria!')
    expect(msg).toContain('Arena Sol')
    expect(msg).not.toContain('Souza')
  })

  it('lista as datas em pt-BR', () => {
    const msg = buildMissedCheckinMessage(base)
    expect(msg).toContain('• 10/07/2026')
    expect(msg).toContain('• 17/07/2026')
  })

  it('pluraliza pela quantidade de datas', () => {
    expect(buildMissedCheckinMessage(base)).toContain('2 aulas')
    expect(buildMissedCheckinMessage({ ...base, dates: ['2026-07-10'] })).toContain('1 aula')
  })

  it('mostra o total em BRL quando há valor', () => {
    // Intl pt-BR separa "R$" do valor com espaço não-quebrável (U+00A0).
    expect(buildMissedCheckinMessage(base)).toMatch(/R\$\s20,00/)
  })

  it('valor 0 → não fala de dinheiro, explica a perda do repasse', () => {
    const msg = buildMissedCheckinMessage({ ...base, amount: 0 })
    expect(msg).not.toContain('R$')
    expect(msg).toContain('a academia não recebe')
  })

  it('bloqueado → avisa que não consegue agendar', () => {
    expect(buildMissedCheckinMessage({ ...base, blocked: true })).toContain('não consegue agendar')
    expect(buildMissedCheckinMessage(base)).not.toContain('não consegue agendar')
  })

  it('sempre termina com o link de resolução', () => {
    expect(buildMissedCheckinMessage(base)).toContain(base.payUrl)
  })
})
