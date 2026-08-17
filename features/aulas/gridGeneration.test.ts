// features/aulas/gridGeneration.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateGrid } from './gridGeneration'

vi.mock('./creditReconciliation', () => ({
  reconcileAllActiveEnrollments: vi.fn().mockResolvedValue({
    booked: 3, skipped: 0, quotaSkipped: 0, missedCheckinSkipped: 0, processedEnrollments: 3, failed: 0,
  }),
}))
import { reconcileAllActiveEnrollments } from './creditReconciliation'

vi.mock('./reopenSessionBookings', () => ({
  restoreSessionBookings: vi.fn().mockResolvedValue({ restoredStudentIds: [], creditStudentIds: [] }),
}))
import { restoreSessionBookings } from './reopenSessionBookings'

/**
 * Fake client: `classes` devolve o que o teste configurar; `class_sessions.upsert`
 * captura as linhas. Só o subconjunto que generateGrid usa.
 *
 * `.eq()` grava os filtros aplicados e o `.then()` de fato filtra `classes` por
 * eles — assim um teste que exige filtro por `classId`/`dayOfWeek` falha de
 * verdade se o `.eq(...)` correspondente for removido do código-fonte.
 */
function makeClient(
  classes: { id: string; day_of_week: number }[],
  upsertError: { message: string } | null = null,
  // Quantas das linhas passadas ao upsert devem ser tratadas como "realmente
  // inseridas" (o resto simula conflito, como ON CONFLICT DO NOTHING faria).
  // Default: todas — reflete os fixtures existentes, que geram do zero.
  insertedCount?: number,
  // Sessões que já existem no banco com status 'cancelled'. É o que o update de
  // reabertura deve encontrar.
  cancelled: { class_id: string; session_date: string }[] = [],
) {
  const upserted: unknown[][] = []
  /** Os filtros de cada update de reabertura, para o teste conferir as travas. */
  const reopenFilters: Record<string, unknown>[] = []
  const from = vi.fn((table: string) => {
    if (table === 'class_sessions') {
      return {
        upsert: (rows: { class_id: string; session_date: string }[]) => {
          upserted.push(rows)
          return {
            select: () =>
              Promise.resolve(
                upsertError
                  ? { data: null, error: upsertError }
                  : {
                      data: rows
                        .slice(0, insertedCount ?? rows.length)
                        .map((r) => ({ id: `${r.class_id}:${r.session_date}` })),
                      error: null,
                    },
              ),
          }
        },
        // update(...).eq(...).in(...).eq(...).select() — a reabertura.
        update: (payload: Record<string, unknown>) => {
          const f: Record<string, unknown> = { payload }
          reopenFilters.push(f)
          const b: Record<string, unknown> = {}
          b.eq = (field: string, value: unknown) => {
            f[field] = value
            return b
          }
          b.in = (field: string, values: unknown[]) => {
            f[field] = values
            return b
          }
          b.select = () => {
            const ids = (f.class_id as string[]) ?? []
            // Só devolve o que casa com TODOS os filtros aplicados, inclusive
            // status: é assim que o teste percebe se uma trava foi removida.
            const hit =
              f.status === 'cancelled'
                ? cancelled.filter(
                    (c) => c.session_date === f.session_date && ids.includes(c.class_id),
                  )
                : []
            return Promise.resolve({
              data: hit.map((c) => ({ id: `${c.class_id}:${c.session_date}` })),
              error: null,
            })
          }
          return b
        },
      }
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
  return { client: { from } as never, upserted, reopenFilters }
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
    expect(r).toEqual({ sessionsCreated: 0, sessionsReopened: 0, studentsBooked: 0, quotaSkipped: 0, missedCheckinSkipped: 0, error: 'upsert boom' })
    expect(reconcileAllActiveEnrollments).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[generateGrid] upsert de class_sessions falhou',
      expect.objectContaining({ orgId: 'org-1', error: 'upsert boom' }),
    )
  })

  it('conta apenas as sessões realmente inseridas quando há conflito parcial (idempotência)', async () => {
    // 2 turmas de terça → 2 linhas tentadas no upsert, mas só 1 é nova (a outra
    // já existia de uma geração anterior e foi pulada pelo ON CONFLICT DO NOTHING).
    const { client, upserted } = makeClient(
      [
        { id: 'c1', day_of_week: 2 },
        { id: 'c2', day_of_week: 2 },
      ],
      null,
      1,
    )
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    expect(upserted[0]).toHaveLength(2) // tentou inserir 2
    expect(r.sessionsCreated).toBe(1) // mas só 1 foi de fato inserida — não rows.length
    expect(r.studentsBooked).toBe(3) // reconciliação roda normalmente após conflito parcial
  })
})

/**
 * A segunda metade da geração. Existe porque o teste de existência do upsert é o
 * índice único (class_id, session_date), que não olha status: sem esta parte, a
 * aula cancelada era conflito, era pulada, e ficava cancelada para sempre.
 */
describe('generateGrid — reabertura de aula cancelada', () => {
  it('devolve a sessão cancelada para scheduled e limpa o motivo', async () => {
    const { client, reopenFilters } = makeClient(
      [{ id: 'c1', day_of_week: 2 }],
      null,
      0, // a linha já existia: o upsert não inseriu nada
      [{ class_id: 'c1', session_date: '2026-07-21' }],
    )
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    expect(r.sessionsCreated).toBe(0)
    expect(r.sessionsReopened).toBe(1)
    expect(reopenFilters[0].payload).toEqual({ status: 'scheduled', cancelled_reason: null })
  })

  it('só toca em quem está cancelled — aula com chamada feita nunca volta', async () => {
    const { client, reopenFilters } = makeClient(
      [{ id: 'c1', day_of_week: 2 }],
      null,
      0,
      [{ class_id: 'c1', session_date: '2026-07-21' }],
    )
    await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    // É esta trava que protege a sessão 'completed': presença já foi gravada em
    // cima dela, e reabrir reescreveria um fato passado.
    expect(reopenFilters[0].status).toBe('cancelled')
  })

  it('restringe a reabertura às turmas ATIVAS do escopo — turma excluída não ressuscita', async () => {
    // c2 não está na lista de turmas ativas (foi excluída: deleteClass cancelou as
    // aulas futuras dela e marcou is_active = false). A aula cancelada dela existe
    // no banco, mas não pode voltar — senão "Gerar semana" desfaria a exclusão.
    const { client, reopenFilters } = makeClient(
      [{ id: 'c1', day_of_week: 2 }],
      null,
      0,
      [
        { class_id: 'c1', session_date: '2026-07-21' },
        { class_id: 'c2', session_date: '2026-07-21' },
      ],
    )
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    expect(reopenFilters[0].class_id).toEqual(['c1'])
    expect(r.sessionsReopened).toBe(1)
  })

  it('devolve as reservas das sessões reabertas ANTES de reconciliar', async () => {
    vi.mocked(restoreSessionBookings).mockClear()
    const { client } = makeClient(
      [{ id: 'c1', day_of_week: 2 }],
      null,
      0,
      [{ class_id: 'c1', session_date: '2026-07-21' }],
    )
    await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    // A ordem é o ponto: a reconciliação só reserva quem NÃO tem reserva na
    // sessão, então liberar as canceladas depois dela não recolocaria ninguém.
    expect(restoreSessionBookings).toHaveBeenCalledWith(client, {
      sessionIds: ['c1:2026-07-21'],
      orgId: 'org-1',
    })
  })

  it('sem nada cancelado, não chama a devolução de reservas', async () => {
    vi.mocked(restoreSessionBookings).mockClear()
    const { client } = makeClient([{ id: 'c1', day_of_week: 2 }])
    const r = await generateGrid('org-1', '2026-07-20', '2026-07-26', {}, client)

    expect(r.sessionsReopened).toBe(0)
    expect(restoreSessionBookings).not.toHaveBeenCalled()
  })
})
