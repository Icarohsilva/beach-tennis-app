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
 */
function makeClient(classes: { id: string; day_of_week: number }[]) {
  const upserted: unknown[][] = []
  const from = vi.fn((table: string) => {
    if (table === 'class_sessions') {
      return { upsert: (rows: unknown[]) => { upserted.push(rows); return Promise.resolve({ error: null }) } }
    }
    // classes: encadeia select/eq/eq... e resolve com a lista (thenable)
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: classes })
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
})
