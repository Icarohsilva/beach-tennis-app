// app/api/cron/complete-past-sessions/route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth/cronAuth', () => ({ verifyCronSecret: vi.fn() }))
vi.mock('@/lib/utils/gridSchedule', () => ({ brtToday: () => '2026-08-19' }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { GET } from './route'
import { verifyCronSecret } from '@/lib/auth/cronAuth'
import { createAdminClient } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))

/**
 * Fake client: só o encadeamento update().eq().lt().select() que a rota usa.
 * Grava os filtros aplicados para o teste conferir as duas travas (status e
 * data), e devolve `rows` como se fossem as sessões atualizadas.
 */
function makeClient(rows: { id: string }[], error: { message: string } | null = null) {
  const filters: Record<string, unknown> = {}
  const from = vi.fn(() => {
    const b: Record<string, unknown> = {}
    b.update = (payload: Record<string, unknown>) => {
      filters.payload = payload
      return b
    }
    b.eq = (field: string, value: unknown) => {
      filters[field] = value
      return b
    }
    b.lt = (field: string, value: unknown) => {
      filters[field] = value
      return b
    }
    b.select = () => Promise.resolve(error ? { data: null, error } : { data: rows, error: null })
    return b
  })
  return { client: { from } as never, filters }
}

const req = {} as never

describe('GET /api/cron/complete-past-sessions', () => {
  it('recusa sem o secret do cron', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(false)
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('fecha só o que está scheduled e é de uma data passada', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(true)
    const { client, filters } = makeClient([{ id: 's1' }, { id: 's2' }])
    vi.mocked(createAdminClient).mockReturnValue(client)

    const res = await GET(req)
    const body = await res.json()

    expect(filters.payload).toEqual({ status: 'completed' })
    expect(filters.status).toBe('scheduled')
    expect(filters.session_date).toBe('2026-08-19')
    expect(body).toEqual({ completed: 2 })
  })

  it('sem nada para fechar, devolve zero', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(true)
    const { client } = makeClient([])
    vi.mocked(createAdminClient).mockReturnValue(client)

    expect(await (await GET(req)).json()).toEqual({ completed: 0 })
  })

  it('erro do banco devolve 500 sem lançar', async () => {
    vi.mocked(verifyCronSecret).mockReturnValue(true)
    const { client } = makeClient([], { message: 'boom' })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const res = await GET(req)
    expect(res.status).toBe(500)
  })
})
