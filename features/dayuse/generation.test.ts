// features/dayuse/generation.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateDayUse, dayUseWindow, DAY_USE_HORIZON_DAYS } from './generation'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))

interface RecRow {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  court: number
  capacity: number
  sport: string | null
  kind: 'scheduled' | 'open'
  price_cents: number | null
  notes: string | null
  created_by: string | null
}

/**
 * Fake client mínimo: `dayuse_recurrences` devolve o que o teste configurar
 * (respeitando os `.eq()` aplicados, para o teste falhar de verdade se o filtro
 * de `is_active`/org sair do código) e `dayuse_slots.upsert` captura as linhas.
 */
function makeClient(
  recurrences: RecRow[],
  opts: { upsertError?: { message: string } | null; insertedCount?: number } = {},
) {
  const upserted: Record<string, unknown>[][] = []
  const upsertOpts: Record<string, unknown>[] = []
  const recFilters: Record<string, unknown> = {}

  const from = vi.fn((table: string) => {
    if (table === 'dayuse_recurrences') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (field: string, value: unknown) => {
        recFilters[field] = value
        return b
      }
      b.order = () => b
      // O recorte por org/is_active é do banco; o teste confere os filtros
      // aplicados via `recFilters` (ver o último caso).
      b.range = () => Promise.resolve({ data: recurrences, error: null })
      return b
    }
    if (table === 'dayuse_slots') {
      return {
        upsert: (rows: Record<string, unknown>[], o: Record<string, unknown>) => {
          upserted.push(rows)
          upsertOpts.push(o)
          return {
            select: () =>
              Promise.resolve(
                opts.upsertError
                  ? { data: null, error: opts.upsertError }
                  : {
                      data: rows
                        .slice(0, opts.insertedCount ?? rows.length)
                        .map((_, i) => ({ id: `slot-${i}` })),
                      error: null,
                    },
              ),
          }
        },
      }
    }
    throw new Error(`tabela inesperada: ${table}`)
  })

  return { client: { from } as never, upserted, upsertOpts, recFilters }
}

const SUNDAY: RecRow = {
  id: 'rec-1',
  day_of_week: 0,
  start_time: '09:00',
  end_time: '12:00',
  court: 1,
  capacity: 12,
  sport: 'beach_tennis',
  kind: 'open',
  price_cents: 4000,
  notes: null,
  created_by: 'admin-1',
}

describe('dayUseWindow', () => {
  it('é um horizonte rolante a partir de hoje', () => {
    expect(dayUseWindow('2026-09-09')).toEqual({ from: '2026-09-09', to: '2026-10-07' })
    expect(DAY_USE_HORIZON_DAYS).toBe(28)
  })
})

describe('generateDayUse', () => {
  it('materializa uma data por ocorrência do dia da semana', async () => {
    const { client, upserted } = makeClient([SUNDAY])
    const r = await generateDayUse('org-1', '2026-09-09', '2026-09-30', client)
    expect(r.error).toBeUndefined()
    expect(r.recurrences).toBe(1)
    expect(r.slotsCreated).toBe(3)
    expect(upserted[0].map((row) => row.date)).toEqual([
      '2026-09-13', '2026-09-20', '2026-09-27',
    ])
  })

  it('grava organization_id e o autor do molde em cada linha', async () => {
    // organization_id explícito porque dayuse_slots não tem trigger trg_set_org;
    // created_by vem do molde porque o cron não tem usuário logado.
    const { client, upserted } = makeClient([SUNDAY])
    await generateDayUse('org-1', '2026-09-13', '2026-09-13', client)
    expect(upserted[0][0]).toMatchObject({
      organization_id: 'org-1',
      created_by: 'admin-1',
      recurrence_id: 'rec-1',
      is_active: true,
      kind: 'open',
      price_cents: 4000,
      capacity: 12,
    })
  })

  it('usa o índice único como chave de idempotência e NÃO sobrescreve o que existe', async () => {
    // ignoreDuplicates é o que faz a passada de amanhã pular as datas de hoje;
    // sem ele o cron reescreveria (ou duplicaria) todo dia.
    const { client, upsertOpts } = makeClient([SUNDAY])
    await generateDayUse('org-1', '2026-09-13', '2026-09-13', client)
    expect(upsertOpts[0]).toEqual({
      onConflict: 'organization_id,court,date,start_time',
      ignoreDuplicates: true,
    })
  })

  it('conta só as linhas realmente inseridas', async () => {
    // Rodar de novo na mesma janela: tudo conflita, nada é criado.
    const { client } = makeClient([SUNDAY], { insertedCount: 0 })
    const r = await generateDayUse('org-1', '2026-09-09', '2026-09-30', client)
    expect(r.slotsCreated).toBe(0)
  })

  it('sem molde ativo não toca em dayuse_slots', async () => {
    const { client, upserted } = makeClient([])
    const r = await generateDayUse('org-1', '2026-09-09', '2026-09-30', client)
    expect(r).toEqual({ slotsCreated: 0, recurrences: 0 })
    expect(upserted).toHaveLength(0)
  })

  it('janela sem nenhuma ocorrência do dia da semana não faz upsert vazio', async () => {
    // 2026-09-14..2026-09-18 é segunda a sexta: nenhum domingo.
    const { client, upserted } = makeClient([SUNDAY])
    const r = await generateDayUse('org-1', '2026-09-14', '2026-09-18', client)
    expect(r.slotsCreated).toBe(0)
    expect(r.recurrences).toBe(1)
    expect(upserted).toHaveLength(0)
  })

  it('devolve error em vez de fingir sucesso quando o upsert falha', async () => {
    // O cron precisa disto para contar falha e mandar ao Sentry.
    const { client } = makeClient([SUNDAY], { upsertError: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await generateDayUse('org-1', '2026-09-13', '2026-09-13', client)
    expect(r.error).toBe('boom')
    expect(r.slotsCreated).toBe(0)
    spy.mockRestore()
  })

  it('filtra por academia e só moldes ativos', async () => {
    const { client, recFilters } = makeClient([SUNDAY])
    await generateDayUse('org-1', '2026-09-13', '2026-09-13', client)
    expect(recFilters.organization_id).toBe('org-1')
    expect(recFilters.is_active).toBe(true)
  })
})
