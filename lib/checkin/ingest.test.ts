import { describe, it, expect } from 'vitest'
import { ingestPartnerCheckin } from './ingest'

// Client falso: suporta o subconjunto de chamadas que o núcleo faz.
// - maybeSingle(): memberships (lookup do aluno), checkins (idempotência)
// - await builder: enrollments (findLinkedSession curto-circuita com [])
// - insert(): checkins, pending_checkins
function makeFakeClient(opts: {
  membership?: { user_id: string; monthly_checkin_target: number } | null
  existingCheckin?: { id: string } | null
}) {
  const inserts: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.in = chain
      builder.limit = chain
      builder.maybeSingle = () => {
        if (table === 'memberships') return Promise.resolve({ data: opts.membership ?? null })
        if (table === 'checkins') return Promise.resolve({ data: opts.existingCheckin ?? null })
        return Promise.resolve({ data: null })
      }
      // findLinkedSession faz `await client.from('enrollments').select().eq().eq()`:
      // o builder precisa ser "thenable" e resolver com lista vazia.
      builder.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: [] })
      builder.insert = (row: unknown) => {
        inserts[table] = [...(inserts[table] ?? []), row]
        return Promise.resolve({ error: null })
      }
      return builder
    },
  }
  return { client: client as never, inserts }
}

describe('ingestPartnerCheckin', () => {
  const base = {
    orgId: 'org-1',
    partner: 'wellhub' as const,
    partnerMemberId: 'GP123456',
    date: '2026-06-25',
    externalRef: 'evt_abc123',
    payload: { raw: true },
  }

  it('casa o aluno por wellhub_id e grava o check-in', async () => {
    const { client, inserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: true, pending: false, linkedSessionId: null })
    expect(inserts.checkins).toHaveLength(1)
    expect(inserts.checkins[0]).toMatchObject({
      organization_id: 'org-1',
      student_id: 'student-1',
      partner: 'wellhub',
      checkin_date: '2026-06-25',
      external_ref: 'evt_abc123',
      validation: 'wellhub',
    })
    expect(inserts.pending_checkins).toBeUndefined()
  })

  it('parqueia como pendente quando o ID não casa', async () => {
    const { client, inserts } = makeFakeClient({ membership: null })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: false, pending: true })
    expect(inserts.pending_checkins).toHaveLength(1)
    expect(inserts.pending_checkins[0]).toMatchObject({
      organization_id: 'org-1',
      partner: 'wellhub',
      partner_member_id: 'GP123456',
      checkin_date: '2026-06-25',
      external_ref: 'evt_abc123',
      resolved: false,
    })
    expect(inserts.checkins).toBeUndefined()
  })

  it('é idempotente: não duplica quando já existe check-in com o mesmo external_ref', async () => {
    const { client, inserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: { id: 'chk-1' },
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: true, pending: false, linkedSessionId: null })
    expect(inserts.checkins).toBeUndefined()
  })
})
