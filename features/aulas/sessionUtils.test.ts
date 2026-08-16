// features/aulas/sessionUtils.test.ts
//
// Só `expectedStudentIds`, e por um motivo específico: avisar de aula cancelada
// olhando apenas `session_bookings` deixava de fora justamente o aluno fixo sem
// reserva gerada — situação normal, porque a reserva do fixo só nasce quando a
// reconciliação roda e ele está elegível. Ele é esperado na quadra e não recebia
// nada.
import { describe, it, expect } from 'vitest'
import { expectedStudentIds } from './sessionUtils'

/** Client mínimo: uma resposta fixa por tabela. */
function makeClient(opts: {
  bookings: { student_id: string; status: string }[]
  enrollments: { student_id: string }[]
}) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve({
          data: table === 'session_bookings' ? opts.bookings : opts.enrollments,
        }).then(resolve),
    }
    return builder
  }
  return { from } as never
}

const INPUT = { orgId: 'org-1', sessionId: 'sess-1', classId: 'class-1' }

describe('expectedStudentIds', () => {
  it('inclui o fixo SEM reserva gerada — o caso que o aviso perdia', async () => {
    const client = makeClient({ bookings: [], enrollments: [{ student_id: 'fixo-1' }] })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['fixo-1'])
  })

  it('inclui quem tem reserva confirmada', async () => {
    const client = makeClient({
      bookings: [{ student_id: 'avulso-1', status: 'confirmed' }],
      enrollments: [],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['avulso-1'])
  })

  it('exclui o fixo que avisou que não vem (reserva cancelada)', async () => {
    const client = makeClient({
      bookings: [{ student_id: 'fixo-1', status: 'cancelled' }],
      enrollments: [{ student_id: 'fixo-1' }, { student_id: 'fixo-2' }],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['fixo-2'])
  })

  // Mesma precedência de mergeSessionAttendees: o que o banco diz que está
  // dentro vence um opt-out antigo.
  it('reserva confirmada vence o opt-out', async () => {
    const client = makeClient({
      bookings: [
        { student_id: 'aluno-1', status: 'confirmed' },
        { student_id: 'aluno-1', status: 'cancelled' },
      ],
      enrollments: [{ student_id: 'aluno-1' }],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['aluno-1'])
  })

  it('não duplica quem é fixo E tem reserva', async () => {
    const client = makeClient({
      bookings: [{ student_id: 'aluno-1', status: 'confirmed' }],
      enrollments: [{ student_id: 'aluno-1' }],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['aluno-1'])
  })

  it('aula sem ninguém devolve lista vazia', async () => {
    const client = makeClient({ bookings: [], enrollments: [] })
    expect(await expectedStudentIds(client, INPUT)).toEqual([])
  })
})
