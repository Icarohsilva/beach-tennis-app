// features/aulas/gridGeneration.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateGrid } from './gridGeneration'

vi.mock('./creditReconciliation', () => ({
  reconcileAllActiveEnrollments: vi.fn().mockResolvedValue({
    booked: 3, skipped: 0, processedEnrollments: 3, failed: 0,
  }),
}))
import { reconcileAllActiveEnrollments } from './creditReconciliation'

/**
 * Fake client: `classes` devolve o que o teste configurar; `class_sessions.upsert`
 * captura as linhas. Só o subconjunto que generateGrid usa.
 *
 * `.eq()` grava os filtros aplicados e o `.then()` de fato filtra `classes` por
 * eles — assim um teste que exige filtro por `classId`/`dayOfWeek` falha de
 * verdade se o `.eq(...)` correspondente for removido do código-fonte.
 */
function makeClient(classes: { id: string; day_of_week: number }[], upsertError: { message: string } | null = null) {
  const upserted: unknown[][] = []
  const from = vi.fn((table: string) => {
    if (table === 'class_sessions') {
      return { upsert: (rows: unknown[]) => { upserted.push(rows); return Promise.resolve({ error: upsertError }) } }
    }
    // classes: encadeia select/eq/eq... e resolve com a lista filtrada (thenable)
    const filters: [string, unknown][] = []
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (field: string, value: unknown) => {
      filters.push([field, value])
      return builder
    }
    builder.then = (resolve: (v: { data: unknown[] }) => void) => {
      // Só filtra por campos que os fixtures modelam (id, day_of_week). Filtros
      // como organization_id/is_active são sempre aplicados por generateGrid mas
      // não fazem parte do fixture — tratados como pass-through aqui.
      const filtered = classes.filter((c) =>
        filters.every(([field, value]) =>
          !(field in c) || (c as Record<string, unknown>)[field] === value,
        ),
      )
      resolve({ data: filtered })
    }
    return builder
  })
  return { client: { from } as never, upserted }
}

describe('generateGrid', () => {
  it('gera as sessões da semana e chama a reconciliação com a mesma janela', async () => {
    const { client, upserted } = makeClient([{ id: 'c1', day_of_week: 2 }]) // terça
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    // buildSessionRows p/ terça no intervalo [seg 20, dom 26] → 1 sessão (21/07 terça).
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toHaveLength(1)
    expect(upserted[0][0]).toMatchObject({ class_id: 'c1', session_date: '2026-07-21', status: 'scheduled' })
    expect(r.sessionsCreated).toBe(1)
    expect(reconcileAllActiveEnrollments).toHaveBeenCalledWith('2026-07-20', '2026-07-26', 'org-1')
    expect(r.studentsBooked).toBe(3)
  })

  it('sem turmas não gera nada nem chama a reconciliação', async () => {
    vi.mocked(reconcileAllActiveEnrollments).mockClear()
    const { client, upserted } = makeClient([])
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)
    expect(upserted).toHaveLength(0)
    expect(r.sessionsCreated).toBe(0)
    expect(reconcileAllActiveEnrollments).not.toHaveBeenCalled()
  })

  it('filtra por classId quando informado', async () => {
    const { client, upserted } = makeClient([
      { id: 'c1', day_of_week: 2 },
      { id: 'c2', day_of_week: 2 },
    ])
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', { classId: 'c1' }, client)
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toHaveLength(1)
    expect(upserted[0][0]).toMatchObject({ class_id: 'c1' })
    expect(r.sessionsCreated).toBe(1)
  })

  it('filtra por dayOfWeek quando informado', async () => {
    const { client, upserted } = makeClient([
      { id: 'c1', day_of_week: 2 }, // terça
      { id: 'c2', day_of_week: 4 }, // quinta
    ])
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', { dayOfWeek: 2 }, client)
    expect(upserted).toHaveLength(1)
    expect(upserted[0]).toHaveLength(1)
    expect(upserted[0][0]).toMatchObject({ class_id: 'c1' })
    expect(r.sessionsCreated).toBe(1)
  })

  it('quando o upsert de class_sessions falha, devolve error e não reconcilia', async () => {
    vi.mocked(reconcileAllActiveEnrollments).mockClear()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = makeClient([{ id: 'c1', day_of_week: 2 }], { message: 'upsert boom' })

    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    // O chamador (cron) precisa de um jeito de distinguir isto de sucesso —
    // sessionsCreated/studentsBooked zerados sozinhos são indistinguíveis de
    // "sem turmas esta semana".
    expect(r).toEqual({ sessionsCreated: 0, studentsBooked: 0, error: 'upsert boom' })
    expect(reconcileAllActiveEnrollments).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[generateGrid] upsert de class_sessions falhou',
      expect.objectContaining({ orgId: 'org-1', error: 'upsert boom' }),
    )
  })
})
