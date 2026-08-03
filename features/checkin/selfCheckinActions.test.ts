// features/checkin/selfCheckinActions.test.ts
//
// A lógica de distância/janela mora em lib/checkin/selfCheckin.test.ts. O que se
// testa aqui são as TRAVAS da action: quem não pode confirmar, quando não pode, e
// a regra de que uma confirmação já validada nunca é rebaixada.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getActiveOrgId: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/features/aulas/sessionUtils', () => ({
  isStudentExpectedInSession: vi.fn(),
}))

vi.mock('@/features/financeiro/classDebt', () => ({
  ensureClassDebt: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

import { confirmSelfAttendance } from './selfCheckinActions'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import { isStudentExpectedInSession } from '@/features/aulas/sessionUtils'

const STUDENT = 'stu-1'
const ORG = 'org-1'

// Academia na orla; o aluno "na quadra" usa exatamente estas coordenadas.
const ARENA = { latitude: -22.971964, longitude: -43.182543 }
const LONGE = { latitude: -23.5505, longitude: -46.6333 }

interface ClientOpts {
  org?: {
    self_checkin_enabled: boolean
    latitude: number | null
    longitude: number | null
    checkin_radius_m: number | null
  } | null
  session?: {
    id: string
    class_id: string
    session_date: string
    status: string
    classes: { start_time: string; end_time: string }
  } | null
  membership?: { partner: string | null } | null
  partnerCheckin?: { id: string } | null
  existingSelfCheckin?: { id: string; status: string } | null
  finalAttendanceStatus?: string
}

/**
 * Stub do client Supabase escopado ao que confirmSelfAttendance consulta.
 * Mesma técnica de features/aulas/adminActions.test.ts.
 */
function makeClient(opts: ClientOpts) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const attendanceUpsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    const resolveRow = () => {
      switch (table) {
        case 'organizations':
          return { data: opts.org ?? null }
        case 'class_sessions':
          return { data: opts.session ?? null }
        case 'memberships':
          return { data: opts.membership ?? { partner: null } }
        case 'checkins':
          return { data: opts.partnerCheckin ?? null }
        case 'self_checkins':
          return { data: opts.existingSelfCheckin ?? null }
        case 'attendance':
          return { data: { status: opts.finalAttendanceStatus ?? 'present' } }
        default:
          return { data: null }
      }
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(resolveRow()),
      single: () => Promise.resolve(resolveRow()),
      upsert: table === 'attendance' ? attendanceUpsert : upsert,
    }
    return builder
  })

  return { client: { from } as never, upsert, attendanceUpsert }
}

function baseOpts(overrides: Partial<ClientOpts> = {}): ClientOpts {
  return {
    org: {
      self_checkin_enabled: true,
      latitude: ARENA.latitude,
      longitude: ARENA.longitude,
      checkin_radius_m: 150,
    },
    session: {
      id: 'sess-1',
      class_id: 'class-1',
      session_date: '2026-08-03',
      status: 'scheduled',
      classes: { start_time: '19:00:00', end_time: '20:00:00' },
    },
    membership: { partner: null },
    ...overrides,
  }
}

/** Dentro da janela da aula das 19h (BRT) de 2026-08-03. */
function freezeInsideWindow() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T19:30:00-03:00'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: STUDENT } } }) },
  } as never)
  vi.mocked(getActiveOrgId).mockResolvedValue(ORG)
  vi.mocked(isStudentExpectedInSession).mockResolvedValue(true)
})

describe('confirmSelfAttendance', () => {
  it('recusa quem não está autenticado', async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    } as never)
    vi.mocked(createAdminClient).mockReturnValue(makeClient(baseOpts()).client)

    expect(await confirmSelfAttendance({ sessionId: 'sess-1' })).toEqual({
      error: 'Não autenticado.',
    })
  })

  it('recusa quando a academia não habilitou o recurso', async () => {
    const { client } = makeClient(
      baseOpts({
        org: {
          self_checkin_enabled: false,
          latitude: ARENA.latitude,
          longitude: ARENA.longitude,
          checkin_radius_m: 150,
        },
      }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('não habilitou')
  })

  it('recusa quando a chamada da aula já foi encerrada', async () => {
    const { client } = makeClient(
      baseOpts({
        session: {
          id: 'sess-1',
          class_id: 'class-1',
          session_date: '2026-08-03',
          status: 'completed',
          classes: { start_time: '19:00:00', end_time: '20:00:00' },
        },
      }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('já foi encerrada')
  })

  it('recusa quem não é esperado na aula', async () => {
    vi.mocked(isStudentExpectedInSession).mockResolvedValue(false)
    const { client } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('não está nesta aula')
  })

  it('recusa fora da janela de confirmação', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T16:00:00-03:00')) // 3h antes do início
    const { client } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('Fora da janela')
    vi.useRealTimers()
  })

  it('não duplica quando o check-in do parceiro já cobre o dia', async () => {
    freezeInsideWindow()
    const { client, upsert } = makeClient(
      baseOpts({ membership: { partner: 'wellhub' }, partnerCheckin: { id: 'chk-1' } }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('parceiro')
    expect(upsert).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('libera o aluno de parceiro quando o webhook não trouxe check-in', async () => {
    freezeInsideWindow()
    const { client, attendanceUpsert } = makeClient(
      baseOpts({ membership: { partner: 'wellhub' }, partnerCheckin: null }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.status).toBe('validated')
    expect(attendanceUpsert).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('valida e marca presença quem está na quadra', async () => {
    freezeInsideWindow()
    const { client, upsert, attendanceUpsert } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })

    expect(result).toEqual({ status: 'validated', distanceM: 0 })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'validated', geo_error: null }),
      { onConflict: 'student_id,session_id' },
    )
    // ignoreDuplicates: nunca sobrescreve o que o professor já marcou.
    expect(attendanceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'present', source: 'self' }),
      { onConflict: 'student_id,session_id', ignoreDuplicates: true },
    )
    vi.useRealTimers()
  })

  it('deixa pendente e NÃO marca presença quem está longe', async () => {
    freezeInsideWindow()
    const { client, upsert, attendanceUpsert } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...LONGE, accuracyM: 10 })

    expect(result.status).toBe('pending')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', geo_error: 'out_of_range' }),
      { onConflict: 'student_id,session_id' },
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('aceita a confirmação sem GPS, como pendente', async () => {
    freezeInsideWindow()
    const { client, upsert, attendanceUpsert } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', geoError: 'denied' })

    expect(result.status).toBe('pending')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', geo_error: 'denied', latitude: null }),
      { onConflict: 'student_id,session_id' },
    )
    expect(attendanceUpsert).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('deixa pendente quando a academia não marcou o ponto', async () => {
    freezeInsideWindow()
    const { client, upsert } = makeClient(
      baseOpts({
        org: {
          self_checkin_enabled: true,
          latitude: null,
          longitude: null,
          checkin_radius_m: 150,
        },
      }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.status).toBe('pending')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ geo_error: 'org_unset' }),
      { onConflict: 'student_id,session_id' },
    )
    vi.useRealTimers()
  })

  it('nunca rebaixa uma confirmação já validada', async () => {
    freezeInsideWindow()
    const { client, upsert } = makeClient(
      baseOpts({ existingSelfCheckin: { id: 'sc-1', status: 'validated' } }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    // Segunda tentativa, agora longe da academia: não pode virar pendente.
    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...LONGE, accuracyM: 10 })

    expect(result.status).toBe('validated')
    expect(upsert).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('não reabre uma confirmação recusada pelo professor', async () => {
    freezeInsideWindow()
    const { client, upsert } = makeClient(
      baseOpts({ existingSelfCheckin: { id: 'sc-1', status: 'rejected' } }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })
    expect(result.error).toContain('recusou')
    expect(upsert).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('sobe de pendente para validada quando o aluno tenta de novo na quadra', async () => {
    freezeInsideWindow()
    const { client, upsert, attendanceUpsert } = makeClient(
      baseOpts({ existingSelfCheckin: { id: 'sc-1', status: 'pending' } }),
    )
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })

    expect(result.status).toBe('validated')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'validated' }),
      { onConflict: 'student_id,session_id' },
    )
    expect(attendanceUpsert).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('não gera dívida quando o professor já tinha marcado falta', async () => {
    freezeInsideWindow()
    const { client } = makeClient(baseOpts({ finalAttendanceStatus: 'absent' }))
    vi.mocked(createAdminClient).mockReturnValue(client)

    const { ensureClassDebt } = await import('@/features/financeiro/classDebt')
    const result = await confirmSelfAttendance({ sessionId: 'sess-1', ...ARENA, accuracyM: 10 })

    expect(result.status).toBe('validated')
    expect(vi.mocked(ensureClassDebt)).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('trata coordenada fora de faixa como ausência de leitura', async () => {
    freezeInsideWindow()
    const { client, upsert } = makeClient(baseOpts())
    vi.mocked(createAdminClient).mockReturnValue(client)

    const result = await confirmSelfAttendance({
      sessionId: 'sess-1',
      latitude: 999,
      longitude: -43.18,
      accuracyM: 10,
    })

    expect(result.status).toBe('pending')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ geo_error: 'unavailable', latitude: null }),
      { onConflict: 'student_id,session_id' },
    )
    vi.useRealTimers()
  })
})
