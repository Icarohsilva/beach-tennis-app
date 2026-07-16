import { describe, it, expect } from 'vitest'
import { requiresCredit, buildReconciliationOps } from './reconciliationOps'

describe('requiresCredit', () => {
  it('é true quando não há parceiro (mensalista/avulso agendam por crédito)', () => {
    expect(requiresCredit(null)).toBe(true)
  })
  it('é false quando há parceiro (wellhub/totalpass agendam por check-in)', () => {
    expect(requiresCredit('wellhub')).toBe(false)
    expect(requiresCredit('totalpass')).toBe(false)
  })
})

describe('buildReconciliationOps', () => {
  const sessions = [
    { id: 's1', session_date: '2026-06-18' },
    { id: 's2', session_date: '2026-06-25' },
  ]

  it('cria uma op por sessão não reservada, com needsCredit e razões', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), true, 'Mensal 1x')
    expect(ops).toEqual([
      {
        sessionId: 's1',
        sessionDate: '2026-06-18',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 18/06',
        debitReason: 'Matrícula fixa — aula 18/06',
      },
      {
        sessionId: 's2',
        sessionDate: '2026-06-25',
        needsCredit: true,
        grantReason: 'Plano Mensal 1x — aula 25/06',
        debitReason: 'Matrícula fixa — aula 25/06',
      },
    ])
  })

  it('pula sessões já reservadas', () => {
    const ops = buildReconciliationOps(sessions, new Set(['s1']), true, 'Mensal 1x')
    expect(ops.map((o) => o.sessionId)).toEqual(['s2'])
  })

  it('marca needsCredit=false quando o caller passa false', () => {
    const ops = buildReconciliationOps(sessions, new Set<string>(), false, 'Mensal 1x')
    expect(ops.every((o) => o.needsCredit === false)).toBe(true)
  })
})
