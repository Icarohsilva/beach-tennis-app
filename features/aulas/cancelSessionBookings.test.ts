// features/aulas/cancelSessionBookings.test.ts
//
// O bug que este arquivo tranca: cancelar a aula marcava só o status da sessão e
// deixava as reservas confirmadas. Quem pagou com crédito não recebia de volta, e
// quem é de plano continuava com a aula contando na cota — a academia desmarcava
// e o aluno pagava a conta.
//
// Stub de client no padrão de adminActions.test.ts / classDebt.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/features/liga/extraPoints', () => ({
  revokeLigaExtra: vi.fn().mockResolvedValue(undefined),
  ENTRY_REASONS: ['waitlist_accept', 'early_booking'],
}))

import { refundSessionBookings } from './cancelSessionBookings'
import { revokeLigaExtra } from '@/features/liga/extraPoints'

interface Booking {
  id: string
  student_id: string
  credit_used: boolean
}

/**
 * Client mínimo: devolve as reservas pedidas, registra os updates e as RPCs.
 * `waitlist` é o que o update na fila devolve no `.select()` final.
 */
function makeClient(opts: {
  bookings: Booking[]
  waitlist?: { student_id: string }[]
  updateError?: { message: string } | null
  rpcError?: { message: string } | null
}) {
  const updates: Record<string, unknown>[] = []
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null })

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, ...patch })
        return builder
      },
      // O caminho das reservas termina em `await ...eq('status','confirmed')`; o
      // da fila termina em `.select('student_id')`. Um builder thenable atende
      // os dois, devolvendo o que cada tabela precisa.
      then: (resolve: (v: unknown) => void) => {
        const wasUpdate = updates.some((u) => u.table === table)
        if (table === 'waitlists') {
          return Promise.resolve({ data: opts.waitlist ?? [], error: null }).then(resolve)
        }
        return Promise.resolve(
          wasUpdate
            ? { data: null, error: opts.updateError ?? null }
            : { data: opts.bookings, error: null },
        ).then(resolve)
      },
    }
    return builder
  })

  return { client: { from, rpc } as never, updates, rpc }
}

const INPUT = {
  sessionId: 'sess-1',
  orgId: 'org-1',
  reason: 'Aula cancelada pela academia',
  sport: 'beach-tennis',
}

beforeEach(() => vi.clearAllMocks())

describe('refundSessionBookings', () => {
  it('estorna crédito só de quem debitou', async () => {
    const { client, rpc } = makeClient({
      bookings: [
        { id: 'b1', student_id: 'stu-1', credit_used: true },
        { id: 'b2', student_id: 'stu-2', credit_used: false },
      ],
    })

    const result = await refundSessionBookings(client, INPUT)

    expect(result.cancelled).toBe(2)
    expect(result.refunded).toBe(1)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('adjust_credits', {
      p_student_id: 'stu-1',
      p_org: 'org-1',
      p_delta: 1,
      p_type: 'refunded',
      p_reason: INPUT.reason,
      p_session_id: 'sess-1',
    })
  })

  // Para quem é de plano ou parceiro não existe crédito a estornar: o que
  // precisa voltar é a CONTAGEM, senão a aula que a academia cancelou segue
  // consumindo o ciclo do aluno.
  it('isenta TODA reserva da cota, inclusive a de quem não usou crédito', async () => {
    const { client, updates } = makeClient({
      bookings: [
        { id: 'b1', student_id: 'stu-1', credit_used: true },
        { id: 'b2', student_id: 'stu-2', credit_used: false },
      ],
    })

    await refundSessionBookings(client, INPUT)

    const bookingUpdates = updates.filter((u) => u.table === 'session_bookings')
    expect(bookingUpdates).toHaveLength(2)
    for (const u of bookingUpdates) {
      expect(u.status).toBe('cancelled')
      expect(u.admin_waived).toBe(true)
      expect(u.cancelled_at).toEqual(expect.any(String))
    }
  })

  // O estorno é best-effort sobre um cancelamento já gravado: reverter aqui
  // deixaria o aluno numa aula que não vai acontecer.
  it('falha de crédito não desfaz o cancelamento', async () => {
    const { client, updates } = makeClient({
      bookings: [{ id: 'b1', student_id: 'stu-1', credit_used: true }],
      rpcError: { message: 'INSUFFICIENT_CREDITS' },
    })

    const result = await refundSessionBookings(client, INPUT)

    expect(result.cancelled).toBe(1)
    expect(result.refunded).toBe(0)
    expect(updates.filter((u) => u.table === 'session_bookings')).toHaveLength(1)
  })

  it('revoga os pontos de entrada da Liga no esporte da turma', async () => {
    const { client } = makeClient({
      bookings: [{ id: 'b1', student_id: 'stu-1', credit_used: false }],
    })

    await refundSessionBookings(client, INPUT)

    expect(revokeLigaExtra).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(revokeLigaExtra).mock.calls) {
      expect(call[1]).toMatchObject({
        orgId: 'org-1',
        studentId: 'stu-1',
        sourceId: 'sess-1',
        sport: 'beach-tennis',
      })
    }
  })

  it('encerra a fila de espera e devolve quem estava nela para ser avisado', async () => {
    const { client, updates } = makeClient({
      bookings: [],
      waitlist: [{ student_id: 'stu-9' }],
    })

    const result = await refundSessionBookings(client, INPUT)

    expect(result.waitlistStudentIds).toEqual(['stu-9'])
    expect(updates.find((u) => u.table === 'waitlists')?.status).toBe('cancelled')
  })

  it('sessão vazia não chama crédito nem Liga', async () => {
    const { client, rpc } = makeClient({ bookings: [] })

    const result = await refundSessionBookings(client, INPUT)

    expect(result).toMatchObject({ cancelled: 0, refunded: 0, studentIds: [] })
    expect(rpc).not.toHaveBeenCalled()
    expect(revokeLigaExtra).not.toHaveBeenCalled()
  })
})
