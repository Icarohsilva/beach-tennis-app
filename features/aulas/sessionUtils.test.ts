// features/aulas/sessionUtils.test.ts
//
// Só `expectedStudentIds`, e por um motivo específico: avisar de aula cancelada
// olhando apenas `session_bookings` deixava de fora justamente o aluno fixo sem
// reserva gerada — situação normal, porque a reserva do fixo só nasce quando a
// reconciliação roda e ele está elegível. Ele é esperado na quadra e não recebia
// nada.
import { describe, it, expect } from 'vitest'
import { expectedStudentIds, isStudentExpectedInSession } from './sessionUtils'

/** Client mínimo: uma resposta fixa por tabela. */
function makeClient(opts: {
  bookings: { student_id: string; status: string }[]
  enrollments: { student_id: string }[]
  waitlist?: { student_id: string }[]
}) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (resolve: (v: unknown) => void) => {
        const data =
          table === 'session_bookings'
            ? opts.bookings
            : table === 'waitlists'
              ? (opts.waitlist ?? [])
              : opts.enrollments
        return Promise.resolve({ data }).then(resolve)
      },
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

  it('exclui o fixo sem reserva que está na fila de espera (turma cheia): fila não é vaga', async () => {
    // Bug relatado: turma com 8 de capacidade e 7 confirmados mostrava 9 na
    // chamada porque o fixo sem reserva, mesmo na fila, contava como esperado.
    const client = makeClient({
      bookings: [],
      enrollments: [{ student_id: 'fixo-1' }, { student_id: 'fixo-2' }],
      waitlist: [{ student_id: 'fixo-2' }],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['fixo-1'])
  })

  it('reserva confirmada vence a fila (estado inconsistente não esconde quem está dentro)', async () => {
    const client = makeClient({
      bookings: [{ student_id: 'aluno-1', status: 'confirmed' }],
      enrollments: [{ student_id: 'aluno-1' }],
      waitlist: [{ student_id: 'aluno-1' }],
    })
    expect(await expectedStudentIds(client, INPUT)).toEqual(['aluno-1'])
  })
})

/** Client mínimo para isStudentExpectedInSession: uma resposta por tabela. */
function makeSingleClient(opts: {
  bookingStatus?: 'confirmed' | 'cancelled'
  waitlistCount?: number
  enrolled?: boolean
}) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => Promise.resolve({ count: opts.waitlistCount ?? 0 }),
      maybeSingle: () => {
        if (table === 'session_bookings') {
          return Promise.resolve({
            data: opts.bookingStatus ? { status: opts.bookingStatus } : null,
          })
        }
        if (table === 'enrollments') {
          return Promise.resolve({ data: opts.enrolled ? { id: 'e1' } : null })
        }
        return Promise.resolve({ data: null })
      },
    }
    return builder
  }
  return { from } as never
}

const SINGLE_INPUT = { orgId: 'org-1', studentId: 'aluno-1', sessionId: 'sess-1', classId: 'class-1' }

describe('isStudentExpectedInSession', () => {
  it('reserva confirmada: esperado', async () => {
    const client = makeSingleClient({ bookingStatus: 'confirmed' })
    expect(await isStudentExpectedInSession(client, SINGLE_INPUT)).toBe(true)
  })

  it('reserva cancelada: não esperado, mesmo sendo fixo', async () => {
    const client = makeSingleClient({ bookingStatus: 'cancelled', enrolled: true })
    expect(await isStudentExpectedInSession(client, SINGLE_INPUT)).toBe(false)
  })

  it('sem reserva, fixo, fora da fila: esperado', async () => {
    const client = makeSingleClient({ enrolled: true, waitlistCount: 0 })
    expect(await isStudentExpectedInSession(client, SINGLE_INPUT)).toBe(true)
  })

  it('sem reserva, fixo, MAS na fila de espera (turma cheia): não esperado — fila não é vaga', async () => {
    // Bug relatado: turma cheia sem conseguir encaixar o fixo o mandava para a
    // fila, mas ele continuava contando como "esperado" na chamada.
    const client = makeSingleClient({ enrolled: true, waitlistCount: 1 })
    expect(await isStudentExpectedInSession(client, SINGLE_INPUT)).toBe(false)
  })

  it('sem reserva e sem matrícula fixa: não esperado', async () => {
    const client = makeSingleClient({ enrolled: false, waitlistCount: 0 })
    expect(await isStudentExpectedInSession(client, SINGLE_INPUT)).toBe(false)
  })
})
