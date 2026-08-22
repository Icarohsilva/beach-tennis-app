import { describe, it, expect, vi } from 'vitest'
import { getCalendarFeedEvents } from './calendarFeedQuery'

vi.mock('@/lib/utils/gridSchedule', () => ({
  brtToday: () => '2026-08-20',
}))

interface SessionFixture {
  id: string
  session_date: string
  class_id: string
  status: string
  start_time?: string | null
  end_time?: string | null
  court?: number | null
  classes: {
    name: string
    start_time: string
    end_time: string
    max_students: number
    court: number | null
  }
}

/**
 * Fake client cobrindo as três tabelas que a query usa. `.eq()`/`.gte()`
 * acumulam filtros aplicados de verdade sobre os fixtures — um teste que
 * depende de `status = 'scheduled'` falha se esse `.eq(...)` sumir do
 * código-fonte, no mesmo espírito do fake client de gridGeneration.test.ts.
 */
function makeClient(input: {
  sessions?: SessionFixture[]
  enrollments?: { class_id: string }[]
  bookings?: { session_id: string }[]
}) {
  const sessions = input.sessions ?? []
  const enrollments = input.enrollments ?? []
  const bookings = input.bookings ?? []

  function builder<T extends Record<string, unknown>>(rows: T[]) {
    const filters: [string, unknown][] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (field: string, value: unknown) => {
      filters.push([field, value])
      return b
    }
    b.gte = (field: string, value: unknown) => {
      filters.push(['__gte__' + field, value])
      return b
    }
    // Terminal — mesmo papel de .range() abaixo: quem chama faz `await` direto
    // no valor devolvido (await de um objeto plano resolve nele mesmo).
    b.in = (field: string, values: unknown[]) => resolved(field, values)
    b.order = () => b
    // Terminal: fetchAllPages faz `await makeQuery(a, b)` — não há mais nada
    // encadeado depois de .range() no código real.
    b.range = () => resolved()
    // Só filtra por campos que os fixtures de fato modelam — igual ao fake
    // client de gridGeneration.test.ts. organization_id/is_active são sempre
    // aplicados pelo código real mas não entram nos fixtures aqui: tratados
    // como pass-through, senão todo fixture teria que repetir esses campos.
    function resolved(inField?: string, inValues?: unknown[]) {
      const data = rows.filter((row) => {
        for (const [field, value] of filters) {
          if (field.startsWith('__gte__')) {
            const col = field.slice('__gte__'.length)
            if (col in row && !(String(row[col]) >= String(value))) return false
          } else if (field in row && row[field] !== value) {
            return false
          }
        }
        if (inField && inField in row && !inValues!.includes(row[inField] as unknown)) return false
        return true
      })
      return { data, error: null }
    }
    return b
  }

  const from = vi.fn((table: string) => {
    if (table === 'class_sessions') return builder(sessions as unknown as Record<string, unknown>[])
    if (table === 'enrollments') return builder(enrollments as unknown as Record<string, unknown>[])
    if (table === 'session_bookings') return builder(bookings as unknown as Record<string, unknown>[])
    throw new Error(`tabela não modelada: ${table}`)
  })

  return { from } as never
}

const TURMA = { name: 'Beach Tennis Iniciante', start_time: '19:00:00', end_time: '20:00:00', max_students: 8, court: 2 }

describe('getCalendarFeedEvents', () => {
  it('sessão cancelada nunca entra — é assim que a assinatura "esquece" um cancelamento', async () => {
    const client = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'cancelled', classes: TURMA },
      ],
      bookings: [{ session_id: 's1' }],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events).toEqual([])
  })

  it('reserva avulsa confirmada entra', async () => {
    const client = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'scheduled', classes: TURMA },
      ],
      bookings: [{ session_id: 's1' }],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ uid: 's1', title: 'Beach Tennis Iniciante', location: 'Quadra 2' })
  })

  it('matrícula fixa entra mesmo sem reserva avulsa na sessão', async () => {
    const client = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'scheduled', classes: TURMA },
      ],
      enrollments: [{ class_id: 'c1' }],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events).toHaveLength(1)
  })

  it('sessão que não é nem reserva nem matrícula do aluno não entra', async () => {
    const client = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'scheduled', classes: TURMA },
      ],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events).toEqual([])
  })

  it('horário e quadra vêm do override da sessão quando existir', async () => {
    const client = makeClient({
      sessions: [
        {
          id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'scheduled',
          start_time: '21:00:00', end_time: '22:00:00', court: 5, classes: TURMA,
        },
      ],
      bookings: [{ session_id: 's1' }],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events[0].location).toBe('Quadra 5')
    expect(events[0].startsAtIso).toBe('2026-08-25T21:00:00-03:00')
    expect(events[0].endsAtIso).toBe('2026-08-25T22:00:00-03:00')
  })

  it('sem quadra resolvida, location é null', async () => {
    const client = makeClient({
      sessions: [
        { id: 's1', session_date: '2026-08-25', class_id: 'c1', status: 'scheduled', classes: { ...TURMA, court: null } },
      ],
      bookings: [{ session_id: 's1' }],
    })
    const events = await getCalendarFeedEvents(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(events[0].location).toBeNull()
  })
})
