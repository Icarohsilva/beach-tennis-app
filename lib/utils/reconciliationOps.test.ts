// lib/utils/reconciliationOps.test.ts
import { describe, it, expect } from 'vitest'
import { buildReconciliationOps } from './reconciliationOps'

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-07-20' },
    { id: 's2', session_date: '2026-07-27' },
  ]

  it('monta uma operação por sessão ainda não reservada', () => {
    expect(buildReconciliationOps(sessions, new Set())).toEqual([
      { sessionId: 's1', sessionDate: '2026-07-20' },
      { sessionId: 's2', sessionDate: '2026-07-27' },
    ])
  })

  it('pula sessões que já têm reserva', () => {
    expect(buildReconciliationOps(sessions, new Set(['s1']))).toEqual([
      { sessionId: 's2', sessionDate: '2026-07-27' },
    ])
  })

  it('todas reservadas devolve lista vazia', () => {
    expect(buildReconciliationOps(sessions, new Set(['s1', 's2']))).toEqual([])
  })

  it('lista vazia devolve lista vazia', () => {
    expect(buildReconciliationOps([], new Set())).toEqual([])
  })
})
