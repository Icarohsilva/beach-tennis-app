import { describe, it, expect } from 'vitest'
import { resolveClassAccess, exceedsDailyCap, resolveEnrollmentRejoin } from './accessRules'

const base = {
  archived: false,
  onVacation: false,
  partner: null,
  hasActivePlan: false,
  creditsBalance: 0,
  hasOpenDebt: false,
  openMissedCheckins: 0,
  missedCheckinBlockLimit: 0,
  quotaEnforced: false,
  quotaRemaining: null,
  bookingsOnDate: 0,
  maxClassesPerDay: 2,
  preferCredit: false,
}

describe('resolveClassAccess', () => {
  // Cadastro inativo é a primeira negação, antes de parceiro e de crédito. Importa
  // testar as duas combinações abaixo porque inativar CANCELA o plano mas PRESERVA o
  // crédito: sem esta regra, um aluno inativado com saldo cairia no `grant: 'credit'`
  // e voltaria a reservar aula sozinho pelo app.
  it('bloqueia cadastro inativo', () => {
    expect(resolveClassAccess({ ...base, archived: true })).toEqual({ denied: 'archived' })
  })

  it('inativo bloqueia mesmo com crédito guardado', () => {
    expect(resolveClassAccess({ ...base, archived: true, creditsBalance: 10 })).toEqual({
      denied: 'archived',
    })
  })

  it('inativo bloqueia mesmo com parceiro', () => {
    expect(resolveClassAccess({ ...base, archived: true, partner: 'wellhub' })).toEqual({
      denied: 'archived',
    })
  })

  it('inativo bloqueia mesmo com plano ativo e cota sobrando', () => {
    expect(
      resolveClassAccess({
        ...base,
        archived: true,
        hasActivePlan: true,
        quotaEnforced: true,
        quotaRemaining: 5,
      }),
    ).toEqual({ denied: 'archived' })
  })

  it('bloqueia quem tem dívida aberta', () => {
    expect(resolveClassAccess({ ...base, hasOpenDebt: true })).toEqual({
      denied: 'blocked_by_debt',
    })
  })

  it('dívida bloqueia mesmo com plano ativo', () => {
    expect(
      resolveClassAccess({ ...base, hasOpenDebt: true, hasActivePlan: true }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('dívida bloqueia mesmo com parceiro e crédito', () => {
    expect(
      resolveClassAccess({ ...base, hasOpenDebt: true, partner: 'wellhub', creditsBalance: 10 }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('parceiro entra sem consumir nada', () => {
    expect(resolveClassAccess({ ...base, partner: 'wellhub' })).toEqual({ grant: 'partner' })
  })

  it('parceiro tem precedência sobre plano', () => {
    expect(
      resolveClassAccess({ ...base, partner: 'totalpass', hasActivePlan: true }),
    ).toEqual({ grant: 'partner' })
  })

  it('plano ativo entra sem consumir crédito, mesmo com saldo', () => {
    expect(
      resolveClassAccess({ ...base, hasActivePlan: true, creditsBalance: 5 }),
    ).toEqual({ grant: 'plan' })
  })

  it('sem plano e sem parceiro, com saldo, usa crédito', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: 1 })).toEqual({ grant: 'credit' })
  })

  it('saldo zero gera dívida', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: 0 })).toEqual({ grant: 'debt' })
  })

  it('saldo negativo gera dívida (defensivo: saldo nunca deveria ser < 0)', () => {
    expect(resolveClassAccess({ ...base, creditsBalance: -3 })).toEqual({ grant: 'debt' })
  })
})

describe('resolveClassAccess — cota', () => {
  const comCota = { ...base, quotaEnforced: true, hasActivePlan: true }

  it('cota desligada preserva o comportamento anterior: plano é ilimitado', () => {
    expect(
      resolveClassAccess({ ...base, hasActivePlan: true, quotaRemaining: 0, bookingsOnDate: 9 }),
    ).toEqual({ grant: 'plan' })
  })

  it('plano com cota restante entra pelo plano', () => {
    expect(resolveClassAccess({ ...comCota, quotaRemaining: 3 })).toEqual({ grant: 'plan' })
  })

  it('cota estourada cai para crédito comprado antes de negar', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 0, creditsBalance: 2 }),
    ).toEqual({ grant: 'credit' })
  })

  it('cota estourada sem crédito nega — não vira dívida', () => {
    expect(resolveClassAccess({ ...comCota, quotaRemaining: 0 })).toEqual({
      denied: 'quota_exhausted',
    })
  })

  it('teto diário nega mesmo com cota sobrando', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 5, bookingsOnDate: 2 }),
    ).toEqual({ denied: 'daily_cap' })
  })

  it('teto diário nega mesmo com crédito comprado', () => {
    expect(
      resolveClassAccess({ ...base, quotaEnforced: true, creditsBalance: 9, bookingsOnDate: 2 }),
    ).toEqual({ denied: 'daily_cap' })
  })

  it('parceiro é isento da cota e do teto diário', () => {
    expect(
      resolveClassAccess({
        ...comCota, partner: 'wellhub', quotaRemaining: 0, bookingsOnDate: 5,
      }),
    ).toEqual({ grant: 'partner' })
  })

  it('dívida bloqueia antes de qualquer eixo de cota', () => {
    expect(
      resolveClassAccess({ ...comCota, hasOpenDebt: true, quotaRemaining: 5 }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('aluno sem plano e sem crédito segue virando dívida', () => {
    expect(
      resolveClassAccess({ ...base, quotaEnforced: true, quotaRemaining: null }),
    ).toEqual({ grant: 'debt' })
  })
})

// Teto 0 = "sem limite diário". A academia que não quer limitar grava 0; antes isso
// caía num default de 2 e não havia como desligar a regra.
describe('resolveClassAccess — teto diário 0 é sem limite', () => {
  it('teto 0 não nega, por mais reservas que o aluno tenha no dia', () => {
    expect(
      resolveClassAccess({
        ...base,
        quotaEnforced: true,
        hasActivePlan: true,
        quotaRemaining: 5,
        bookingsOnDate: 9,
        maxClassesPerDay: 0,
      }),
    ).toEqual({ grant: 'plan' })
  })

  it('teto negativo (dado torto) também não nega', () => {
    expect(exceedsDailyCap(9, -1)).toBe(false)
  })

  it('teto positivo segue valendo', () => {
    expect(exceedsDailyCap(1, 2)).toBe(false)
    expect(exceedsDailyCap(2, 2)).toBe(true)
  })
})

// Escolher o crédito é comprar a aula de novo. Os dois limites que ele fura são os
// do plano; as negações de acesso continuam de pé.
describe('resolveClassAccess — aluno escolhe pagar com crédito', () => {
  const comCota = { ...base, quotaEnforced: true, hasActivePlan: true, preferCredit: true }

  it('usa crédito mesmo com cota do plano sobrando', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 5, creditsBalance: 1 }),
    ).toEqual({ grant: 'credit' })
  })

  it('fura a cota esgotada', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 0, creditsBalance: 1 }),
    ).toEqual({ grant: 'credit' })
  })

  it('fura o teto diário', () => {
    expect(
      resolveClassAccess({
        ...comCota, quotaRemaining: 5, creditsBalance: 1, bookingsOnDate: 9,
      }),
    ).toEqual({ grant: 'credit' })
  })

  it('sem saldo, a preferência é ignorada e a regra normal volta a valer', () => {
    expect(
      resolveClassAccess({ ...comCota, quotaRemaining: 5, creditsBalance: 0 }),
    ).toEqual({ grant: 'plan' })
    expect(
      resolveClassAccess({
        ...comCota, quotaRemaining: 5, creditsBalance: 0, bookingsOnDate: 2,
      }),
    ).toEqual({ denied: 'daily_cap' })
  })

  it('não compra dívida, cadastro inativo nem pendência de check-in', () => {
    expect(
      resolveClassAccess({ ...comCota, creditsBalance: 5, hasOpenDebt: true }),
    ).toEqual({ denied: 'blocked_by_debt' })
    expect(
      resolveClassAccess({ ...comCota, creditsBalance: 5, archived: true }),
    ).toEqual({ denied: 'archived' })
    expect(
      resolveClassAccess({
        ...comCota,
        creditsBalance: 5,
        partner: 'wellhub',
        openMissedCheckins: 3,
        missedCheckinBlockLimit: 2,
      }),
    ).toEqual({ denied: 'blocked_by_missed_checkins' })
  })

  it('parceiro continua entrando de graça, sem gastar crédito à toa', () => {
    expect(
      resolveClassAccess({ ...comCota, creditsBalance: 5, partner: 'wellhub' }),
    ).toEqual({ grant: 'partner' })
  })
})

describe('resolveClassAccess — pendência de check-in', () => {
  const parceiro = { ...base, partner: 'wellhub' as const }

  it('limite 0 (default) não bloqueia nem com muitas pendências', () => {
    expect(
      resolveClassAccess({ ...parceiro, openMissedCheckins: 9, missedCheckinBlockLimit: 0 }),
    ).toEqual({ grant: 'partner' })
  })

  it('abaixo do limite o parceiro entra normalmente', () => {
    expect(
      resolveClassAccess({ ...parceiro, openMissedCheckins: 2, missedCheckinBlockLimit: 3 }),
    ).toEqual({ grant: 'partner' })
  })

  it('no limite bloqueia o parceiro — que é isento de cota mas não disto', () => {
    expect(
      resolveClassAccess({ ...parceiro, openMissedCheckins: 3, missedCheckinBlockLimit: 3 }),
    ).toEqual({ denied: 'blocked_by_missed_checkins' })
  })

  it('bloqueia mesmo com plano ativo e crédito em conta', () => {
    expect(
      resolveClassAccess({
        ...parceiro,
        hasActivePlan: true,
        creditsBalance: 10,
        openMissedCheckins: 4,
        missedCheckinBlockLimit: 2,
      }),
    ).toEqual({ denied: 'blocked_by_missed_checkins' })
  })

  it('dívida de aula avulsa continua tendo precedência', () => {
    expect(
      resolveClassAccess({
        ...parceiro,
        hasOpenDebt: true,
        openMissedCheckins: 5,
        missedCheckinBlockLimit: 2,
      }),
    ).toEqual({ denied: 'blocked_by_debt' })
  })

  it('bloqueia antes de qualquer eixo de cota', () => {
    expect(
      resolveClassAccess({
        ...base,
        hasActivePlan: true,
        quotaEnforced: true,
        quotaRemaining: 5,
        openMissedCheckins: 2,
        missedCheckinBlockLimit: 2,
      }),
    ).toEqual({ denied: 'blocked_by_missed_checkins' })
  })
})

// Férias é ausência DECLARADA: o aluno avisou que não vem, a grade foi gerada
// sem ele, e a vaga já foi para a fila. Nenhuma forma de pagamento compra isso
// de volta — senão ele entraria sozinho pelo app no dia seguinte ao pedido.
describe('resolveClassAccess — férias', () => {
  it('de férias, não entra', () => {
    expect(resolveClassAccess({ ...base, onVacation: true })).toEqual({
      denied: 'on_vacation',
    })
  })

  it('nem com plano, crédito ou parceiro', () => {
    expect(
      resolveClassAccess({ ...base, onVacation: true, hasActivePlan: true }),
    ).toEqual({ denied: 'on_vacation' })
    expect(
      resolveClassAccess({ ...base, onVacation: true, creditsBalance: 10 }),
    ).toEqual({ denied: 'on_vacation' })
    expect(
      resolveClassAccess({ ...base, onVacation: true, partner: 'wellhub' }),
    ).toEqual({ denied: 'on_vacation' })
  })

  it('nem escolhendo pagar com crédito', () => {
    expect(
      resolveClassAccess({
        ...base, onVacation: true, preferCredit: true, creditsBalance: 5,
      }),
    ).toEqual({ denied: 'on_vacation' })
  })

  // Cadastro inativo é o estado mais forte: quem saiu da academia não está
  // "de férias", está fora.
  it('cadastro inativo tem precedência sobre férias', () => {
    expect(
      resolveClassAccess({ ...base, archived: true, onVacation: true }),
    ).toEqual({ denied: 'archived' })
  })

  it('fora do período, nada muda', () => {
    expect(resolveClassAccess({ ...base, onVacation: false, hasActivePlan: true })).toEqual({
      grant: 'plan',
    })
  })
})

describe('resolveEnrollmentRejoin', () => {
  it('saída que não gerou crédito: volta grátis', () => {
    expect(resolveEnrollmentRejoin({ creditRefunded: false, creditsBalance: 0 })).toBe('free')
    expect(resolveEnrollmentRejoin({ creditRefunded: false, creditsBalance: 7 })).toBe('free')
  })

  it('saída que gerou crédito e o aluno ainda tem: retoma o crédito', () => {
    expect(resolveEnrollmentRejoin({ creditRefunded: true, creditsBalance: 1 })).toBe('clawback')
  })

  it('crédito de reposição já gasto: cobra como avulsa, não dá duas aulas por uma', () => {
    expect(resolveEnrollmentRejoin({ creditRefunded: true, creditsBalance: 0 })).toBe(
      'price_normally',
    )
  })
})
