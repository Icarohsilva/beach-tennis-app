import { describe, it, expect } from 'vitest'
import { mensagemErroSenha } from './authErrors'

describe('mensagemErroSenha', () => {
  it('traduz senha igual à anterior', () => {
    expect(mensagemErroSenha('same_password')).toBe(
      'A nova senha precisa ser diferente da senha atual.',
    )
  })

  it('traduz senha fraca', () => {
    expect(mensagemErroSenha('weak_password')).toContain('6 caracteres')
  })

  it('traduz sessão perdida com instrução do que fazer', () => {
    expect(mensagemErroSenha('session_expired')).toContain('login novamente')
    expect(mensagemErroSenha('session_not_found')).toContain('login novamente')
  })

  it('traduz excesso de tentativas', () => {
    expect(mensagemErroSenha('over_request_rate_limit')).toContain('Aguarde')
  })

  it('cai no genérico em português para código desconhecido', () => {
    expect(mensagemErroSenha('algo_novo_do_supabase')).toBe(
      'Não foi possível alterar a senha. Tente novamente.',
    )
    expect(mensagemErroSenha(undefined)).toBe(
      'Não foi possível alterar a senha. Tente novamente.',
    )
  })

  it('nunca devolve texto em inglês', () => {
    const codigos = [
      'same_password',
      'weak_password',
      'session_expired',
      'session_not_found',
      'over_request_rate_limit',
      undefined,
      'desconhecido',
    ]
    for (const c of codigos) {
      expect(mensagemErroSenha(c)).not.toMatch(/password|should be|Invalid/i)
    }
  })
})
