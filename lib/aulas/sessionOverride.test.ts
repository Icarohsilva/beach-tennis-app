import { describe, it, expect } from 'vitest'
import { resolveSession, hasOverride, CLEARED_OVERRIDES } from './sessionOverride'

const turma = {
  start_time: '19:00:00',
  end_time: '20:00:00',
  court: 2,
  max_students: 8,
}

describe('resolveSession', () => {
  it('sem override, tudo herda a turma', () => {
    expect(resolveSession(null, turma)).toEqual({
      startTime: '19:00:00',
      endTime: '20:00:00',
      court: 2,
      maxStudents: 8,
    })
  })

  it('override vence a turma campo a campo', () => {
    expect(
      resolveSession({ start_time: '18:00:00', end_time: '19:00:00' }, turma),
    ).toEqual({
      startTime: '18:00:00',
      endTime: '19:00:00',
      court: 2,
      maxStudents: 8,
    })
  })

  it('override parcial não apaga o que não foi tocado', () => {
    expect(resolveSession({ court: 5 }, turma).maxStudents).toBe(8)
    expect(resolveSession({ max_students: 4 }, turma).court).toBe(2)
  })

  it('turma sem quadra devolve null, não undefined', () => {
    expect(resolveSession(null, { ...turma, court: null }).court).toBeNull()
  })

  // `??` e não `||`: com `||` uma capacidade 0 gravada por engano cairia
  // silenciosamente no valor da turma e a tela mostraria vagas que não existem.
  it('capacidade 0 não é confundida com "sem override"', () => {
    expect(resolveSession({ max_students: 0 }, turma).maxStudents).toBe(0)
  })
})

describe('hasOverride', () => {
  it('nada preenchido é herança pura', () => {
    expect(hasOverride(null)).toBe(false)
    expect(hasOverride({})).toBe(false)
    expect(hasOverride(CLEARED_OVERRIDES)).toBe(false)
  })

  it('qualquer campo preenchido marca a data como alterada', () => {
    expect(hasOverride({ start_time: '18:00:00' })).toBe(true)
    expect(hasOverride({ court: 3 })).toBe(true)
    expect(hasOverride({ max_students: 6 })).toBe(true)
  })
})
