import { describe, it, expect } from 'vitest'
import { requiresEditModeChoice, carryForwardAcks, type ExistingAck } from './versioningRules'

describe('requiresEditModeChoice', () => {
  it('draft nunca exige escolha', () => {
    expect(requiresEditModeChoice('draft', 0)).toBe(false)
    expect(requiresEditModeChoice('draft', 5)).toBe(false)
  })

  it('published sem ninguém ter confirmado ainda não exige escolha', () => {
    expect(requiresEditModeChoice('published', 0)).toBe(false)
  })

  it('published com pelo menos um ack exige escolha', () => {
    expect(requiresEditModeChoice('published', 1)).toBe(true)
  })

  it('archived não exige escolha mesmo com acks — não bloqueia mais ninguém', () => {
    expect(requiresEditModeChoice('archived', 3)).toBe(false)
  })
})

describe('carryForwardAcks', () => {
  const acks: ExistingAck[] = [
    {
      userId: 'u1',
      signedName: 'Fulano',
      signedCpf: '12345678900',
      coveredDependents: null,
      ipAddress: '1.2.3.4',
      userAgent: 'ua',
      ackedAt: '2026-01-01T00:00:00Z',
    },
  ]

  it('correção mantém os acks — quem assinou continua valendo', () => {
    expect(carryForwardAcks('correction', acks)).toEqual(acks)
  })

  it('mudança de conteúdo não carrega nenhum — todo mundo volta a aparecer pendente', () => {
    expect(carryForwardAcks('content_change', acks)).toEqual([])
  })

  it('sem acks anteriores, qualquer modo devolve lista vazia', () => {
    expect(carryForwardAcks('correction', [])).toEqual([])
  })
})
