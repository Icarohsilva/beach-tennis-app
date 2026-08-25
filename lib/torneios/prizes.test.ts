// lib/torneios/prizes.test.ts
import { describe, it, expect } from 'vitest'
import { sortPrizes, positionLabel, totalPrizeCents, prizeForPosition, pendingDelivery, type PrizeRow } from './prizes'

function prize(overrides: Partial<PrizeRow> = {}): PrizeRow {
  return {
    id: 'p1',
    kind: 'podium',
    position: 1,
    description: 'Troféu',
    value_cents: null,
    delivered_at: null,
    ...overrides,
  }
}

describe('positionLabel', () => {
  it('1/2/3 têm nome especial; demais são "Nº lugar"', () => {
    expect(positionLabel(1)).toBe('Campeão')
    expect(positionLabel(2)).toBe('Vice')
    expect(positionLabel(3)).toBe('3º lugar')
    expect(positionLabel(4)).toBe('4º lugar')
  })
})

describe('sortPrizes', () => {
  it('pódio em ordem de colocação, especiais depois', () => {
    const rows = [
      prize({ id: 'special', kind: 'special', position: null }),
      prize({ id: '3', position: 3 }),
      prize({ id: '1', position: 1 }),
      prize({ id: '2', position: 2 }),
    ]
    expect(sortPrizes(rows).map((r) => r.id)).toEqual(['1', '2', '3', 'special'])
  })
})

describe('totalPrizeCents', () => {
  it('soma só o que tem valor; prêmio em texto (nulo) não conta e não gera NaN', () => {
    const rows = [prize({ value_cents: 10000 }), prize({ value_cents: null }), prize({ value_cents: 5000 })]
    expect(totalPrizeCents(rows)).toBe(15000)
  })

  it('lista vazia soma 0', () => {
    expect(totalPrizeCents([])).toBe(0)
  })
})

describe('prizeForPosition', () => {
  it('acha o prêmio da colocação — o que casa com winner2_id', () => {
    const rows = [prize({ id: 'a', position: 1 }), prize({ id: 'b', position: 2 })]
    expect(prizeForPosition(rows, 2)?.id).toBe('b')
  })

  it('sem prêmio naquela colocação, devolve null', () => {
    expect(prizeForPosition([prize({ position: 1 })], 3)).toBeNull()
  })

  it('ignora prêmios especiais (position nula) na busca por colocação', () => {
    const rows = [prize({ id: 'special', kind: 'special', position: null })]
    expect(prizeForPosition(rows, 1)).toBeNull()
  })
})

describe('pendingDelivery', () => {
  it('filtra só os não entregues', () => {
    const rows = [prize({ id: 'a', delivered_at: null }), prize({ id: 'b', delivered_at: '2026-08-01T00:00:00Z' })]
    expect(pendingDelivery(rows).map((r) => r.id)).toEqual(['a'])
  })
})
