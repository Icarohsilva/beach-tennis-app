import { describe, it, expect } from 'vitest'
import { resolveClassAccess } from './accessRules'

const base = {
  partner: null,
  hasActivePlan: false,
  creditsBalance: 0,
  hasOpenDebt: false,
  quotaEnforced: false,
  quotaRemaining: null,
  bookingsOnDate: 0,
  maxClassesPerDay: 2,
}

describe('resolveClassAccess', () => {
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
