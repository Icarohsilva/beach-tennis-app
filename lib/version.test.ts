import { describe, it, expect } from 'vitest'
import { precisaRecarregar, precisaReautenticar } from './version'

describe('precisaRecarregar', () => {
  it('build diferente da que está no ar → recarrega', () => {
    expect(precisaRecarregar('abc123', 'def456')).toBe(true)
  })

  it('mesma build → não faz nada', () => {
    expect(precisaRecarregar('abc123', 'abc123')).toBe(false)
  })

  // O caso que evita o pior defeito possível desta feature: uma página que se
  // recarrega em laço. Em dev os dois lados são 'dev'; se só um lado tivesse a env
  // definida, cada reload traria a mesma divergência e recarregaria de novo.
  it('não recarrega em desenvolvimento', () => {
    expect(precisaRecarregar('dev', 'dev')).toBe(false)
    expect(precisaRecarregar('dev', 'abc123')).toBe(false)
    expect(precisaRecarregar('abc123', 'dev')).toBe(false)
  })

  it('resposta sem buildId utilizável não recarrega', () => {
    expect(precisaRecarregar('abc123', undefined)).toBe(false)
    expect(precisaRecarregar('abc123', null)).toBe(false)
    expect(precisaRecarregar('abc123', '')).toBe(false)
    expect(precisaRecarregar('abc123', 42)).toBe(false)
  })
})

describe('precisaReautenticar', () => {
  // Sem este caso, o deploy que INTRODUZ o mecanismo deslogaria a base inteira:
  // ninguém tem o cookie ainda.
  it('cookie ausente não desloga', () => {
    expect(precisaReautenticar(undefined, 1)).toBe(false)
    expect(precisaReautenticar('', 5)).toBe(false)
  })

  it('época antiga → precisa entrar de novo', () => {
    expect(precisaReautenticar('1', 2)).toBe(true)
    expect(precisaReautenticar('1', 9)).toBe(true)
  })

  it('época em dia → segue logado', () => {
    expect(precisaReautenticar('2', 2)).toBe(false)
  })

  it('época adiante (rollback do deploy) não desloga', () => {
    expect(precisaReautenticar('3', 2)).toBe(false)
  })

  it('cookie corrompido não desloga', () => {
    expect(precisaReautenticar('abc', 2)).toBe(false)
    expect(precisaReautenticar('{}', 2)).toBe(false)
  })
})
