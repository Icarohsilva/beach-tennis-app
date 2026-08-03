import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ingestPartnerCheckin } from './ingest'

vi.mock('./wellhubValidate', () => ({
  validateWellhubCheckin: vi.fn(),
}))

// ensureClassDebt é testado à parte (features/financeiro/classDebt.test.ts) e tem
// suas próprias consultas multi-tabela — mockado aqui pra isolar o que este arquivo
// testa de fato: o WIRING de findLinkedSession/recordResolvedCheckin (é chamado ou
// não, com quais argumentos), não a lógica interna de pendência.
vi.mock('@/features/financeiro/classDebt', () => ({
  ensureClassDebt: vi.fn(),
}))

// resolveOpenMissedCheckinByExtraVisit tem sua própria bateria de testes
// (features/checkin/missedCheckins.test.ts) — aqui só se prova o WIRING: é
// chamada (ou não) no caminho certo, com os argumentos certos.
vi.mock('@/features/checkin/missedCheckins', () => ({
  resolveOpenMissedCheckinByExtraVisit: vi.fn(),
}))

import { validateWellhubCheckin } from './wellhubValidate'
import { ensureClassDebt } from '@/features/financeiro/classDebt'
import { resolveOpenMissedCheckinByExtraVisit } from '@/features/checkin/missedCheckins'

// Client falso: suporta o subconjunto de chamadas que o núcleo faz.
// - maybeSingle(): memberships (lookup do aluno), checkins (idempotência),
//   attendance (releitura pós-upsert em recordResolvedCheckin)
// - await builder: class_sessions e session_bookings (findLinkedSession) —
//   controláveis via opts.classSessions/opts.sessionBookings; default []
// - insert(): checkins, pending_checkins (este último com .select('id').single())
// - upsert(): attendance — simula o ignoreDuplicates: só grava se ainda não
//   existir uma linha para o par (aluno, sessão); senão preserva o status atual.
// - update(): checkins, pending_checkins (fire-and-forget, encadeia .eq())
function makeFakeClient(opts: {
  membership?: { user_id: string; monthly_checkin_target: number } | null
  existingCheckin?: { id: string } | null
  pendingInsertErrorCode?: string
  classSessions?: { id: string; session_date: string; class: { start_time: string } | null }[]
  sessionBookings?: { session_id: string }[]
  existingAttendance?: { status: string } | null
}) {
  const inserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}
  const upserts: Record<string, unknown[]> = {}
  // Só uma linha de attendance é relevante por teste (um aluno, uma sessão) —
  // simplifica o fake em vez de indexar por (student_id, session_id).
  let attendanceStatus: string | null = opts.existingAttendance?.status ?? null
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
        if (table === 'attendance') {
          return Promise.resolve({
            data: attendanceStatus !== null ? { status: attendanceStatus } : null,
          })
        }
        return Promise.resolve({ data: null })
      }
      // findLinkedSession faz `await client.from('class_sessions').select()...` e,
      // se achar candidatos, `await client.from('session_bookings').select()...`:
      // o builder precisa ser "thenable" para ambas.
      builder.then = (resolve: (v: { data: unknown[] }) => void) => {
        if (table === 'class_sessions') return resolve({ data: opts.classSessions ?? [] })
        if (table === 'session_bookings') return resolve({ data: opts.sessionBookings ?? [] })
        return resolve({ data: [] })
      }
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
      builder.upsert = (row: unknown) => {
        upserts[table] = [...(upserts[table] ?? []), row]
        if (table === 'attendance') {
          // ignoreDuplicates: só grava se ainda não havia linha — nunca sobrescreve
          // um status já existente (ex.: 'absent' marcado pelo professor).
          if (attendanceStatus === null) {
            attendanceStatus = (row as { status: string }).status
          }
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
  return { client: client as never, inserts, updates, upserts }
}

describe('ingestPartnerCheckin', () => {
  const base = {
    orgId: 'org-1',
    partner: 'wellhub' as const,
    partnerMemberId: 'GP123456',
    date: '2026-06-25',
    checkinAt: '2026-06-25T22:00:00Z',
    externalRef: 'evt_abc123',
    payload: { raw: true },
  }

  beforeEach(() => {
    vi.mocked(validateWellhubCheckin).mockReset()
    vi.mocked(ensureClassDebt).mockReset()
    vi.mocked(resolveOpenMissedCheckinByExtraVisit).mockReset().mockResolvedValue({ resolved: false })
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
    // Sem sessão vinculada (nenhuma classSessions configurada): visita avulsa,
    // tenta dar baixa numa pendência em aberto.
    expect(resolveOpenMissedCheckinByExtraVisit).toHaveBeenCalledWith(client, {
      orgId: 'org-1',
      studentId: 'student-1',
      partner: 'wellhub',
      checkinDate: '2026-06-25',
    })
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

  // base.checkinAt = '2026-06-25T22:00:00Z'. sessionStartIso('2026-06-25','19:00:00')
  // = '2026-06-25T19:00:00-03:00' = instante 22:00:00Z — mesmo instante do checkinAt,
  // exercitando o caminho de match de findLinkedSession de ponta a ponta (não só a
  // função pura findSessionInWindow, isolada em sessionWindow.test.ts).
  it('marca presença quando há sessão com reserva confirmada dentro da janela de ±1h', async () => {
    const { client, upserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
      classSessions: [
        { id: 'ses-1', session_date: '2026-06-25', class: { start_time: '19:00:00' } },
      ],
      sessionBookings: [{ session_id: 'ses-1' }],
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res.linkedSessionId).toBe('ses-1')
    expect(upserts.attendance).toHaveLength(1)
    expect(upserts.attendance[0]).toMatchObject({
      session_id: 'ses-1',
      student_id: 'student-1',
      status: 'present',
    })
    expect(ensureClassDebt).toHaveBeenCalledWith(client, {
      orgId: 'org-1',
      studentId: 'student-1',
      sessionId: 'ses-1',
    })
    // Há sessão vinculada: NÃO é visita avulsa, não tenta dar baixa em nada.
    expect(resolveOpenMissedCheckinByExtraVisit).not.toHaveBeenCalled()
  })

  it('não marca presença quando a sessão existe mas está fora da janela de ±1h', async () => {
    // start_time 17:00:00 BRT = 20:00:00Z — 2h de distância do checkinAt (22:00:00Z).
    const { client, upserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
      classSessions: [
        { id: 'ses-1', session_date: '2026-06-25', class: { start_time: '17:00:00' } },
      ],
      sessionBookings: [{ session_id: 'ses-1' }],
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res.linkedSessionId).toBeNull()
    expect(upserts.attendance).toBeUndefined()
    expect(ensureClassDebt).not.toHaveBeenCalled()
    // Sem sessão dentro da janela = visita avulsa: tenta dar baixa numa pendência.
    expect(resolveOpenMissedCheckinByExtraVisit).toHaveBeenCalledWith(client, {
      orgId: 'org-1',
      studentId: 'student-1',
      partner: 'wellhub',
      checkinDate: '2026-06-25',
    })
  })

  it('não marca presença quando o aluno não tem reserva confirmada na sessão', async () => {
    const { client, upserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
      classSessions: [
        { id: 'ses-1', session_date: '2026-06-25', class: { start_time: '19:00:00' } },
      ],
      sessionBookings: [], // sem reserva confirmada
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res.linkedSessionId).toBeNull()
    expect(upserts.attendance).toBeUndefined()
    expect(ensureClassDebt).not.toHaveBeenCalled()
    expect(resolveOpenMissedCheckinByExtraVisit).toHaveBeenCalledWith(client, {
      orgId: 'org-1',
      studentId: 'student-1',
      partner: 'wellhub',
      checkinDate: '2026-06-25',
    })
  })

  it('a baixa automática falhando não derruba o registro do check-in (best-effort)', async () => {
    vi.mocked(resolveOpenMissedCheckinByExtraVisit).mockRejectedValue(new Error('boom'))
    const { client, inserts } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res).toEqual({ recorded: true, pending: false, linkedSessionId: null })
    expect(inserts.checkins).toHaveLength(1)
  })

  it('não gera pendência quando a presença já estava marcada como absent (ignoreDuplicates preserva)', async () => {
    // Regressão: ensureClassDebt não pode disparar pra aluno cuja presença final
    // ficou 'absent' — ignoreDuplicates não sobrescreve o que o professor já marcou.
    const { client } = makeFakeClient({
      membership: { user_id: 'student-1', monthly_checkin_target: 12 },
      existingCheckin: null,
      classSessions: [
        { id: 'ses-1', session_date: '2026-06-25', class: { start_time: '19:00:00' } },
      ],
      sessionBookings: [{ session_id: 'ses-1' }],
      existingAttendance: { status: 'absent' },
    })
    const res = await ingestPartnerCheckin(base, client)
    expect(res.linkedSessionId).toBe('ses-1')
    expect(ensureClassDebt).not.toHaveBeenCalled()
    expect(resolveOpenMissedCheckinByExtraVisit).not.toHaveBeenCalled()
  })
})
