import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ingestPartnerCheckin } from './ingest'

vi.mock('./wellhubValidate', () => ({
  validateWellhubCheckin: vi.fn(),
}))

import { validateWellhubCheckin } from './wellhubValidate'

// Client falso: suporta o subconjunto de chamadas que o núcleo faz.
// - maybeSingle(): memberships (lookup do aluno), checkins (idempotência)
// - await builder: enrollments (findLinkedSession curto-circuita com [])
// - insert(): checkins, pending_checkins (este último com .select('id').single())
// - update(): checkins, pending_checkins (fire-and-forget, encadeia .eq())
function makeFakeClient(opts: {
  membership?: { user_id: string; monthly_checkin_target: number } | null
  existingCheckin?: { id: string } | null
  pendingInsertErrorCode?: string
}) {
  const inserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}
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
        if (table === 'pending_checkins') {
          // ingest.ts sempre encadeia .select('id').single() nesse insert.
          const error = opts.pendingInsertErrorCode
            ? { code: opts.pendingInsertErrorCode, message: 'duplicate' }
            : null
          const data = error ? null : { id: 'pending-1' }
          return { select: () => ({ single: () => Promise.resolve({ data, error }) }) }
        }
        return Promise.resolve({ error: null })
      }
      builder.update = (patch: unknown) => {
        updates[table] = [...(updates[table] ?? []), patch]
        return builder
      }
      return builder
    },
  }
  return { client: client as never, inserts, updates }
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

  beforeEach(() => {
    vi.mocked(validateWellhubCheckin).mockReset()
  })

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
    expect(validateWellhubCheckin).not.toHaveBeenCalled()
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

  it('valida um check-in pendente novo quando há config de validate (aluno ainda não cadastrado)', async () => {
    vi.mocked(validateWellhubCheckin).mockResolvedValue({ valid: true })
    const { client, updates } = makeFakeClient({ membership: null })
    const res = await ingestPartnerCheckin(
      { ...base, validate: { apiKey: 'key-1', gymId: '505', environment: 'sandbox' } },
      client,
    )
    expect(res).toEqual({ recorded: false, pending: true })
    expect(validateWellhubCheckin).toHaveBeenCalledWith({
      environment: 'sandbox',
      gymId: '505',
      apiKey: 'key-1',
      gympassId: 'GP123456',
    })
    expect(updates.pending_checkins).toEqual([
      { partner_validated: true, partner_validation_error: null },
    ])
  })

  it('grava o erro de validação quando o validate falha para um pendente', async () => {
    vi.mocked(validateWellhubCheckin).mockResolvedValue({ valid: false, error: 'HTTP 401' })
    const { client, updates } = makeFakeClient({ membership: null })
    await ingestPartnerCheckin(
      { ...base, validate: { apiKey: 'key-1', gymId: '505', environment: 'sandbox' } },
      client,
    )
    expect(updates.pending_checkins).toEqual([
      { partner_validated: false, partner_validation_error: 'HTTP 401' },
    ])
  })

  it('não valida o pendente quando não há config de validate (sem api_key)', async () => {
    const { client, updates } = makeFakeClient({ membership: null })
    await ingestPartnerCheckin(base, client)
    expect(validateWellhubCheckin).not.toHaveBeenCalled()
    expect(updates.pending_checkins).toBeUndefined()
  })

  it('não revalida um pendente reenviado (mesmo external_ref já enfileirado)', async () => {
    const { client, updates } = makeFakeClient({ membership: null, pendingInsertErrorCode: '23505' })
    const res = await ingestPartnerCheckin(
      { ...base, validate: { apiKey: 'key-1', gymId: '505', environment: 'sandbox' } },
      client,
    )
    expect(res).toEqual({ recorded: false, pending: true })
    expect(validateWellhubCheckin).not.toHaveBeenCalled()
    expect(updates.pending_checkins).toBeUndefined()
  })
})
