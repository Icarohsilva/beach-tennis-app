import { describe, it, expect } from 'vitest'
import { shouldAutoStart } from './autostart'

describe('shouldAutoStart', () => {
  it('aluno inicia na /home quando nunca viu', () => {
    expect(shouldAutoStart('aluno', '/home', null)).toBe(true)
  })

  it('aluno NÃO inicia fora da /home', () => {
    expect(shouldAutoStart('aluno', '/aulas', null)).toBe(false)
  })

  it('aluno NÃO inicia se já viu', () => {
    expect(shouldAutoStart('aluno', '/home', '2026-07-02T00:00:00Z')).toBe(false)
  })

  it('admin inicia em qualquer rota do painel', () => {
    expect(shouldAutoStart('admin', '/admin/financeiro', null)).toBe(true)
  })

  it('admin NÃO inicia se já viu', () => {
    expect(shouldAutoStart('admin', '/admin/dashboard', '2026-07-02T00:00:00Z')).toBe(false)
  })
})
