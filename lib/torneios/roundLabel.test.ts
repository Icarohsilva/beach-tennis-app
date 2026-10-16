import { describe, it, expect } from 'vitest'
import { roundLabeler } from './roundLabel'

const m = (round: number, group_label: string | null = null) => ({ round, group_label })

describe('roundLabeler', () => {
  it('Super conta rodadas', () => {
    const label = roundLabeler('americano', [m(1), m(1), m(7)])
    expect(label(1, null)).toBe('Rodada 1')
    expect(label(7, null)).toBe('Rodada 7')
  })

  it('eliminatória nomeia a fase pela distância até a final', () => {
    const label = roundLabeler('eliminatoria', [m(1), m(2), m(3)])
    expect(label(1, null)).toBe('Quartas de final')
    expect(label(2, null)).toBe('Semifinal')
    expect(label(3, null)).toBe('Final')
  })

  it('grupos + mata-mata: o mata-mata conta a partir de onde os grupos pararam', () => {
    const label = roundLabeler('grupos', [m(1, 'A'), m(3, 'B'), m(4), m(5)])
    expect(label(2, 'A')).toBe('Rodada 2')
    expect(label(4, null)).toBe('Semifinal')
    expect(label(5, null)).toBe('Final')
  })

  it('formato de chave ainda sem mata-mata gerado fica no número', () => {
    const label = roundLabeler('grupos', [m(1, 'A'), m(2, 'A')])
    expect(label(1, 'A')).toBe('Rodada 1')
  })
})
