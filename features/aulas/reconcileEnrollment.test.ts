import { describe, it, expect, vi } from 'vitest'
import { reconcileEnrollmentCredits } from './reconcileEnrollment'

/**
 * Stub escopado ao que reconcileEnrollmentCredits consulta: a turma
 * (max_students), as sessões agendadas no intervalo, e as reservas já
 * existentes do aluno nelas. `rpcCalls` captura as chamadas de
 * book_session_atomic; `bookErrors` simula falha (SESSION_FULL/corrida) pro
 * sessionId indicado.
 */
function makeClient(opts: {
  sessions: { id: string; session_date: string }[]
  alreadyBooked?: string[]
  bookErrors?: Set<string>
}) {
  const rpcCalls: { p_session_id: string }[] = []
  const rpc = vi.fn((_fn: string, args: { p_session_id: string }) => {
    rpcCalls.push(args)
    if (opts.bookErrors?.has(args.p_session_id)) {
      return Promise.resolve({ error: { message: 'SESSION_FULL' } })
    }
    return Promise.resolve({ error: null })
  })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      single: () => Promise.resolve({ data: { max_students: 10, organization_id: 'org-1' } }),
      then: (resolve: (v: { data: unknown }) => void) => {
        const data =
          table === 'class_sessions'
            ? opts.sessions
            : table === 'session_bookings'
              ? (opts.alreadyBooked ?? []).map((id) => ({ session_id: id }))
              : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from, rpc } as never, rpcCalls }
}

describe('reconcileEnrollmentCredits', () => {
  it('sem orçamento de cota, reserva todas as sessões pendentes (comportamento de sempre)', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client)

    expect(r).toEqual({ booked: 2, skipped: 0, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(2)
  })

  it('orçamento 0 pula todas as sessões pendentes sem reservar nenhuma', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 0)

    expect(r).toEqual({ booked: 0, skipped: 0, quotaSkipped: 2 })
    expect(rpcCalls).toHaveLength(0)
  })

  it('orçamento 1 com 2 pendentes reserva a primeira e pula a segunda', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 1)

    expect(r).toEqual({ booked: 1, skipped: 0, quotaSkipped: 1 })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].p_session_id).toBe('s1')
  })

  it('falha do RPC conta como skipped, não quotaSkipped, e não consome orçamento', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
      bookErrors: new Set(['s1']),
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client, 5)

    expect(r).toEqual({ booked: 1, skipped: 1, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(2)
  })

  it('sessões já reservadas não entram nas operações (idempotente)', async () => {
    const { client, rpcCalls } = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-07-07' },
        { id: 's2', session_date: '2026-07-14' },
      ],
      alreadyBooked: ['s1'],
    })

    const r = await reconcileEnrollmentCredits('stu-1', 'class-1', '2026-07-01', '2026-07-31', client)

    expect(r).toEqual({ booked: 1, skipped: 0, quotaSkipped: 0 })
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].p_session_id).toBe('s2')
  })
})
