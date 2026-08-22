// app/api/calendar/[token]/route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/features/aulas/calendarFeedQuery', () => ({ getCalendarFeedEvents: vi.fn() }))
vi.mock('@/lib/aulas/icsFeed', () => ({ buildIcsCalendar: vi.fn(() => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n') }))

import { GET } from './route'
import { createAdminClient } from '@/lib/supabase/server'
import { getCalendarFeedEvents } from '@/features/aulas/calendarFeedQuery'
import { buildIcsCalendar } from '@/lib/aulas/icsFeed'

/**
 * Fake client: só o encadeamento select().eq().maybeSingle() que a rota usa
 * para achar a membership pelo token. `row` é o que o banco "devolveria".
 */
function makeClient(row: Record<string, unknown> | null) {
  const filters: Record<string, unknown> = {}
  const from = vi.fn(() => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (field: string, value: unknown) => {
      filters[field] = value
      return b
    }
    b.maybeSingle = () => Promise.resolve({ data: row })
    return b
  })
  return { client: { from } as never, filters }
}

const req = {} as never

describe('GET /api/calendar/[token]', () => {
  it('token inexistente devolve 404, sem consultar as aulas', async () => {
    const { client } = makeClient(null)
    vi.mocked(createAdminClient).mockReturnValue(client)

    const res = await GET(req, { params: { token: 'nao-existe' } })

    expect(res.status).toBe(404)
    expect(getCalendarFeedEvents).not.toHaveBeenCalled()
  })

  // Mesmo status de "não existe" — um link desligado não pode dar nenhuma
  // pista de que já existiu um dia (ver comentário da rota).
  it('sincronização desligada devolve 404, mesmo com token válido', async () => {
    const { client } = makeClient({
      user_id: 'aluno-1', organization_id: 'org-1', calendar_sync_enabled: false,
      organizations: { name: 'Arena X' },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)

    const res = await GET(req, { params: { token: 'abc' } })

    expect(res.status).toBe(404)
    expect(getCalendarFeedEvents).not.toHaveBeenCalled()
  })

  it('token válido e ligado devolve o .ics com o content-type certo', async () => {
    const { client, filters } = makeClient({
      user_id: 'aluno-1', organization_id: 'org-1', calendar_sync_enabled: true,
      organizations: { name: 'Arena X' },
    })
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(getCalendarFeedEvents).mockResolvedValue([])

    const res = await GET(req, { params: { token: 'abc' } })

    expect(filters.calendar_feed_token).toBe('abc')
    expect(getCalendarFeedEvents).toHaveBeenCalledWith(client, { orgId: 'org-1', studentId: 'aluno-1' })
    expect(buildIcsCalendar).toHaveBeenCalledWith('Agenda Arena X', [], expect.any(String))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(await res.text()).toContain('BEGIN:VCALENDAR')
  })
})
