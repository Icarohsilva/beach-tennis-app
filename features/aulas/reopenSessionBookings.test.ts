// features/aulas/reopenSessionBookings.test.ts
import { describe, it, expect, vi } from 'vitest'
import { restoreSessionBookings } from './reopenSessionBookings'

interface Booking {
  id: string
  student_id: string
  credit_used: boolean
  status: string
  cancelled_by_session: boolean
}

/**
 * Cliente falso de session_bookings.
 *
 * O `.then()` aplica os filtros de verdade, e é isso que dá valor ao teste: se
 * alguém trocar `cancelled_by_session` por `admin_waived` no código-fonte, a
 * reserva do aluno que o professor tirou da data passa pelo filtro e o teste
 * quebra.
 */
function makeClient(bookings: Booking[]) {
  const deleted: string[][] = []
  const from = vi.fn(() => {
    const filters: [string, unknown][] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (field: string, value: unknown) => {
      filters.push([field, value])
      return b
    }
    // `.in('session_id', ...)` é pass-through: os fixtures são todos da sessão
    // pedida, e o que este teste mede são os filtros de coluna.
    b.in = () => b
    b.delete = () => {
      const d: Record<string, unknown> = {}
      d.in = (_field: string, ids: string[]) => {
        deleted.push(ids)
        return Promise.resolve({ error: null })
      }
      return d
    }
    b.then = (resolve: (v: { data: Booking[]; error: null }) => void) => {
      const matches = bookings.filter((row) =>
        filters.every(([field, value]) => {
          if (field === 'organization_id') return true
          return (row as unknown as Record<string, unknown>)[field] === value
        }),
      )
      resolve({ data: matches, error: null })
    }
    return b
  })
  return { client: { from } as never, deleted }
}

const CANCELADA_PELA_AULA: Booking = {
  id: 'b-fixo',
  student_id: 'aluno-fixo',
  credit_used: false,
  status: 'cancelled',
  cancelled_by_session: true,
}

describe('restoreSessionBookings', () => {
  it('apaga a reserva sem crédito para a reconciliação recriá-la', async () => {
    const { client, deleted } = makeClient([CANCELADA_PELA_AULA])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(deleted).toEqual([['b-fixo']])
    expect(r.restoredStudentIds).toEqual(['aluno-fixo'])
    expect(r.creditStudentIds).toEqual([])
  })

  // Re-debitar o crédito poderia falhar (o aluno pode ter gasto) e desfaria uma
  // decisão dele. Ele é convidado a entrar de novo, não recolocado.
  it('quem pagou com crédito NÃO volta, mas entra na lista de convidados', async () => {
    const { client, deleted } = makeClient([
      { ...CANCELADA_PELA_AULA, id: 'b-cred', student_id: 'aluno-cred', credit_used: true },
    ])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(deleted).toEqual([])
    expect(r.restoredStudentIds).toEqual([])
    expect(r.creditStudentIds).toEqual(['aluno-cred'])
  })

  it('separa os dois públicos na mesma sessão', async () => {
    const { client, deleted } = makeClient([
      CANCELADA_PELA_AULA,
      { ...CANCELADA_PELA_AULA, id: 'b-cred', student_id: 'aluno-cred', credit_used: true },
    ])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(deleted).toEqual([['b-fixo']])
    expect(r.restoredStudentIds).toEqual(['aluno-fixo'])
    expect(r.creditStudentIds).toEqual(['aluno-cred'])
  })

  // O motivo da coluna existir. `admin_waived` marcaria esta reserva também, e
  // trazê-la de volta desfaria uma decisão do professor.
  it('não devolve quem o professor tirou daquela data', async () => {
    const { client, deleted } = makeClient([
      {
        id: 'b-removido',
        student_id: 'aluno-removido',
        credit_used: false,
        status: 'cancelled',
        cancelled_by_session: false,
      },
    ])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(deleted).toEqual([])
    expect(r.restoredStudentIds).toEqual([])
  })

  it('não mexe em reserva confirmada', async () => {
    const { client, deleted } = makeClient([{ ...CANCELADA_PELA_AULA, status: 'confirmed' }])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(deleted).toEqual([])
    expect(r.restoredStudentIds).toEqual([])
  })

  it('sem sessão nenhuma, não consulta o banco', async () => {
    const { client } = makeClient([CANCELADA_PELA_AULA])
    const r = await restoreSessionBookings(client, { sessionIds: [], orgId: 'org-1' })

    expect(r).toEqual({ restoredStudentIds: [], creditStudentIds: [] })
    expect((client as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled()
  })

  it('não repete aluno que tinha reserva em várias sessões reabertas', async () => {
    const { client } = makeClient([
      CANCELADA_PELA_AULA,
      { ...CANCELADA_PELA_AULA, id: 'b-fixo-2' },
    ])
    const r = await restoreSessionBookings(client, { sessionIds: ['s1'], orgId: 'org-1' })

    expect(r.restoredStudentIds).toEqual(['aluno-fixo'])
  })
})
