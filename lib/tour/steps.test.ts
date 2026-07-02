import { describe, it, expect } from 'vitest'
import { getTourSteps } from './steps'

describe('getTourSteps', () => {
  it('aluno tem 4 passos', () => {
    expect(getTourSteps('aluno')).toHaveLength(4)
  })

  it('admin tem 5 passos (inclui torneios)', () => {
    const steps = getTourSteps('admin')
    expect(steps).toHaveLength(5)
    const selectors = steps.map((s) => s.element)
    expect(selectors).toContain('[data-tour="tour-admin-torneios"]')
  })

  it('todo passo com element aponta para um seletor data-tour', () => {
    for (const s of getTourSteps('aluno')) {
      if (s.element) expect(s.element).toMatch(/^\[data-tour="tour-/)
    }
  })

  it('todo passo tem título e descrição', () => {
    for (const variant of ['aluno', 'admin'] as const) {
      for (const s of getTourSteps(variant)) {
        expect(s.popover.title.length).toBeGreaterThan(0)
        expect(s.popover.description.length).toBeGreaterThan(0)
      }
    }
  })
})
