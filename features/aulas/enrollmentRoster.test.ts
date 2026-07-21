import { describe, it, expect } from 'vitest'
import { getClassRoster } from './enrollmentRoster'

/**
 * Fake client: `classes` grava os filtros de `.eq()` e o `.then()` de fato
 * filtra por eles — mesma técnica de gridGeneration.test.ts, para que um teste
 * que exige filtro por dayOfWeek/classId falhe de verdade se o `.eq(...)`
 * correspondente for removido do código-fonte. `enrollments`/`memberships`/
 * `student_subscriptions` continuam pass-through simples: getClassRoster não
 * aplica opts a elas (só a `classes`).
 */
function makeClient(data: {
  classes: { id: string; day_of_week: number }[]
  enrollments: { class_id: string; student_id: string }[]
  memberships: { user_id: string; partner: string | null; pending_partner: string | null }[]
  subs: { student_id: string; gateway: string; current_period_end: string | null }[]
}) {
  return {
    from(table: string) {
      if (table === 'classes') {
        const filters: [string, unknown][] = []
        const builder: any = {
          select() { return builder },
          eq(field: string, value: unknown) {
            filters.push([field, value])
            return builder
          },
          then(resolve: (v: { data: unknown[] }) => void) {
            const filtered = data.classes.filter((c) =>
              filters.every(([field, value]) =>
                !(field in c) || (c as Record<string, unknown>)[field] === value,
              ),
            )
            resolve({ data: filtered })
          },
        }
        return builder
      }
      const rowsByTable: Record<string, unknown[]> = {
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
    expect(c1.eligible).toBe(1)
    expect(c1.pendingConfirmation).toBe(1)
    expect(c1.noPlan).toBe(1)
    expect(c1.enrolled).toBe(3)
  })

  it('filtra por dayOfWeek', async () => {
    const client = makeClient({
      classes: [
        { id: 'c1', day_of_week: 2 },
        { id: 'c2', day_of_week: 4 }, // fora do escopo do filtro abaixo
      ],
      enrollments: [
        { class_id: 'c1', student_id: 'a' },
        { class_id: 'c2', student_id: 'z' }, // apareceria em totals se o filtro não funcionasse
      ],
      memberships: [
        { user_id: 'a', partner: 'wellhub', pending_partner: null },
        { user_id: 'z', partner: 'wellhub', pending_partner: null },
      ],
      subs: [],
    })
    const roster = await getClassRoster(client, 'org1', { dayOfWeek: 2 })
    expect(roster.byClass.has('c2')).toBe(false)
    expect(roster.byClass.has('c1')).toBe(true)
    expect(roster.totals.enrolled).toBe(1)
    expect(roster.totals.eligible).toBe(1)
  })

  it('filtra por classId', async () => {
    const client = makeClient({
      classes: [
        { id: 'c1', day_of_week: 2 },
        { id: 'c2', day_of_week: 2 }, // mesmo dia, só o id difere
      ],
      enrollments: [
        { class_id: 'c1', student_id: 'a' },
        { class_id: 'c2', student_id: 'z' }, // apareceria em totals se o filtro não funcionasse
      ],
      memberships: [
        { user_id: 'a', partner: 'wellhub', pending_partner: null },
        { user_id: 'z', partner: 'wellhub', pending_partner: null },
      ],
      subs: [],
    })
    const roster = await getClassRoster(client, 'org1', { classId: 'c1' })
    expect(roster.byClass.has('c2')).toBe(false)
    expect(roster.byClass.has('c1')).toBe(true)
    expect(roster.totals.enrolled).toBe(1)
    expect(roster.totals.eligible).toBe(1)
  })
})
