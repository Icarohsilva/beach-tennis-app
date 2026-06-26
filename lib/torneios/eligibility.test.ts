// lib/torneios/eligibility.test.ts
import { describe, it, expect } from 'vitest'
import {
  canRegister,
  canReportResult,
  canConfirmResult,
  type EligibilityMatch,
} from './eligibility'

const match: EligibilityMatch = {
  player1_id: 'a',
  partner1_id: 'b',
  player2_id: 'c',
  partner2_id: 'd',
  reported_by: null,
}

describe('canRegister', () => {
  it('masculino: aceita M, barra F, pede perfil se null', () => {
    expect(canRegister('M', 'masculino').ok).toBe(true)
    expect(canRegister('F', 'masculino').ok).toBe(false)
    const semGenero = canRegister(null, 'masculino')
    expect(semGenero.ok).toBe(false)
    expect(semGenero.reason).toMatch(/perfil/i)
  })

  it('feminino: aceita F, barra M', () => {
    expect(canRegister('F', 'feminino').ok).toBe(true)
    expect(canRegister('M', 'feminino').ok).toBe(false)
  })

  it('misto e livre: aceitam qualquer gênero, inclusive null', () => {
    for (const cat of ['misto', 'livre'] as const) {
      expect(canRegister('M', cat).ok).toBe(true)
      expect(canRegister('F', cat).ok).toBe(true)
      expect(canRegister(null, cat).ok).toBe(true)
    }
  })
})

describe('canReportResult', () => {
  it('aceita qualquer um dos 4 jogadores', () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(canReportResult(id, match)).toBe(true)
    }
  })
  it('barra quem não está na partida', () => {
    expect(canReportResult('x', match)).toBe(false)
  })
})

describe('canConfirmResult', () => {
  it('admin sempre confirma', () => {
    expect(canConfirmResult('x', { ...match, reported_by: 'a' }, true)).toBe(true)
  })
  it('dupla adversária à de reported_by confirma', () => {
    const m = { ...match, reported_by: 'a' } // a/b reportaram
    expect(canConfirmResult('c', m, false)).toBe(true)
    expect(canConfirmResult('d', m, false)).toBe(true)
  })
  it('a própria dupla de reported_by não confirma', () => {
    const m = { ...match, reported_by: 'a' }
    expect(canConfirmResult('a', m, false)).toBe(false)
    expect(canConfirmResult('b', m, false)).toBe(false)
  })
  it('estranho não confirma; sem reported_by ninguém confirma (exceto admin)', () => {
    expect(canConfirmResult('x', { ...match, reported_by: 'a' }, false)).toBe(false)
    expect(canConfirmResult('c', { ...match, reported_by: null }, false)).toBe(false)
  })
})
