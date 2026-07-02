import { describe, it, expect } from 'vitest'
import { getFaqs } from './faqs'

describe('getFaqs', () => {
  it('aluno tem ao menos 4 FAQs', () => {
    expect(getFaqs('aluno').length).toBeGreaterThanOrEqual(4)
  })

  it('admin tem ao menos 4 FAQs', () => {
    expect(getFaqs('admin').length).toBeGreaterThanOrEqual(4)
  })

  it('toda FAQ tem pergunta e resposta preenchidas', () => {
    for (const variant of ['aluno', 'admin'] as const) {
      for (const f of getFaqs(variant)) {
        expect(f.q.length).toBeGreaterThan(0)
        expect(f.a.length).toBeGreaterThan(0)
      }
    }
  })
})
