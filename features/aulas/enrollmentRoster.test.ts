import { describe, it, expect } from 'vitest'
import { getClassRoster } from './enrollmentRoster'

// Fake client mínimo: responde por tabela com filtros irrelevantes ignorados.
function makeClient(data: {
  classes: { id: string; day_of_week: number }[]
  enrollments: { class_id: string; student_id: string }[]
  memberships: { user_id: string; partner: string | null; pending_partner: string | null }[]
  subs: { student_id: string; gateway: string; current_period_end: string | null }[]
}) {
  return {
    from(table: string) {
      const rowsByTable: Record<string, unknown[]> = {
        classes: data.classes,
        enrollments: data.enrollments,
        memberships: data.memberships,
        student_subscriptions: data.subs,
      }
      const builder: any = {
        _rows: rowsByTable[table] ?? [],
        select() { return builder },
        eq() { return builder },
        in() { return builder },
        then(resolve: (v: { data: unknown[] }) => void) { resolve({ data: builder._rows }) },
      }
      return builder
    },
  } as any
}

describe('getClassRoster', () => {
  it('classifica cada matriculado por status', async () => {
    const client = makeClient({
      classes: [{ id: 'c1', day_of_week: 2 }],
      enrollments: [
        { class_id: 'c1', student_id: 'a' },
        { class_id: 'c1', student_id: 'b' },
        { class_id: 'c1', student_id: 'd' },
      ],
      memberships: [
        { user_id: 'a', partner: null, pending_partner: null }, // plano → elegivel
        { user_id: 'b', partner: null, pending_partner: 'wellhub' }, // a_confirmar
        { user_id: 'd', partner: null, pending_partner: null }, // sem_plano
      ],
      subs: [{ student_id: 'a', gateway: 'manual', current_period_end: null }], // manual = vigente
    })
    const roster = await getClassRoster(client, 'org1')
    const c1 = roster.byClass.get('c1')!
    expect(c1.elegivel).toBe(1)
    expect(c1.aConfirmar).toBe(1)
    expect(c1.semPlano).toBe(1)
    expect(c1.matriculados).toBe(3)
  })

  it('filtra por dayOfWeek', async () => {
    const client = makeClient({
      classes: [{ id: 'c1', day_of_week: 2 }],
      enrollments: [{ class_id: 'c1', student_id: 'a' }],
      memberships: [{ user_id: 'a', partner: 'wellhub', pending_partner: null }],
      subs: [],
    })
    const roster = await getClassRoster(client, 'org1', { dayOfWeek: 2 })
    expect(roster.totals.elegivel).toBe(1)
  })
})
