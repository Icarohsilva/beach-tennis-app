import { describe, it, expect } from 'vitest'
import { resolveClassAccess } from './accessRules'

const base = { partner: null, hasActivePlan: false, creditsBalance: 0, hasOpenDebt: false }

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
