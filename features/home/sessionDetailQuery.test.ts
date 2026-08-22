import { describe, it, expect, vi, beforeEach } from 'vitest'

// A ficha só precisa do cliente para as três leituras abaixo; o resto do módulo
// (self check-in, dependentes) é stub porque não é o que está sob teste aqui.
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/features/checkin/selfCheckinQueries', () => ({
  getSelfCheckinViews: vi.fn(async () => new Map()),
}))
vi.mock('@/features/aulas/guardianQueries', () => ({
  listGuardianDependents: vi.fn(async () => []),
}))

import { buildAgendaSessions, type SessionRowWithClass } from './sessionDetailQuery'

const ME = 'aluno-1'
const OUTRO = 'aluno-2'

type Booking = { id: string; session_id: string; student_id: string; status: string; from_enrollment?: boolean; nome?: string }

/** Stub escopado às três tabelas que buildAgendaSessions lê. */
function makeClient(opts: {
  bookings?: Booking[]
  enrollments?: { class_id: string; student_id: string; nome?: string }[]
  waitlists?: { id: string; session_id: string; student_id: string }[]
}) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        let data: unknown = []
        if (table === 'session_bookings') {
          data = (opts.bookings ?? []).map((b) => ({
            id: b.id,
            session_id: b.session_id,
            student_id: b.student_id,
            status: b.status,
            from_enrollment: b.from_enrollment ?? false,
            profiles: { full_name: b.nome ?? b.student_id },
          }))
        } else if (table === 'enrollments') {
          data = (opts.enrollments ?? []).map((e) => ({
            class_id: e.class_id,
            student_id: e.student_id,
            profiles: { full_name: e.nome ?? e.student_id },
          }))
        } else if (table === 'waitlists') {
          data = (opts.waitlists ?? []).map((w) => ({
            id: w.id,
            session_id: w.session_id,
            student_id: w.student_id,
            profiles: { full_name: w.student_id },
          }))
        }
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

const ROW: SessionRowWithClass = {
  id: 'sess-1',
  session_date: '2026-08-20',
  class_id: 'turma-1',
  status: 'scheduled',
  classes: {
    name: 'Beach Tennis Iniciante',
    start_time: '07:00',
    end_time: '08:00',
    type: 'adult',
    sport: 'beach_tennis',
    max_students: 4,
  },
}

async function build(client: never, rows: SessionRowWithClass[] = [ROW]) {
  return buildAgendaSessions(client, {
    orgId: 'org-1',
    userId: ME,
    partner: null,
    selfCheckinEnabled: false,
    enrolledClassIds: new Set(['turma-1']),
    rows,
    creditsBalance: 0,
    hasPlanQuota: false,
  })
}

describe('buildAgendaSessions — aluno fixo e o opt-out da data', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fixo sem opt-out: a aula é dele', async () => {
    const [s] = await build(
      makeClient({ enrollments: [{ class_id: 'turma-1', student_id: ME, nome: 'Eu' }] }),
    )
    expect(s.fixed).toBe(true)
    expect(s.fixedOptedOut).toBeUndefined()
    expect(s.attendees).toContain('Eu')
  })

  it('fixo que avisou que não vem: a aula deixa de ser dele e ele sai da lista', async () => {
    // Era o bug relatado: `fixed` continuava true, `isIn` no modal seguia
    // verdadeiro e nunca aparecia "Entrar na aula" nem a fila de espera.
    const [s] = await build(
      makeClient({
        enrollments: [{ class_id: 'turma-1', student_id: ME, nome: 'Eu' }],
        bookings: [
          { id: 'b1', session_id: 'sess-1', student_id: ME, status: 'cancelled', from_enrollment: true, nome: 'Eu' },
        ],
      }),
    )
    expect(s.fixed).toBe(false)
    expect(s.fixedOptedOut).toBe(true)
    expect(s.attendees).not.toContain('Eu')
    expect(s.booked).toBe(0)
  })

  it('reserva confirmada vence o opt-out (mesma precedência de mergeSessionAttendees)', async () => {
    const [s] = await build(
      makeClient({
        enrollments: [{ class_id: 'turma-1', student_id: ME, nome: 'Eu' }],
        bookings: [
          { id: 'b1', session_id: 'sess-1', student_id: ME, status: 'confirmed', from_enrollment: true, nome: 'Eu' },
        ],
      }),
    )
    expect(s.mine).toBe(true)
    expect(s.fixed).toBe(true)
    expect(s.fixedOptedOut).toBeUndefined()
    expect(s.attendees).toContain('Eu')
  })

  it('opt-out de OUTRO aluno não mexe no meu fixed', async () => {
    const [s] = await build(
      makeClient({
        enrollments: [
          { class_id: 'turma-1', student_id: ME, nome: 'Eu' },
          { class_id: 'turma-1', student_id: OUTRO, nome: 'Outro' },
        ],
        bookings: [
          { id: 'b2', session_id: 'sess-1', student_id: OUTRO, status: 'cancelled', from_enrollment: true, nome: 'Outro' },
        ],
      }),
    )
    expect(s.fixed).toBe(true)
    expect(s.fixedOptedOut).toBeUndefined()
    expect(s.attendees).toEqual(['Eu'])
  })

  it('não sou fixo da turma: nem fixed nem fixedOptedOut', async () => {
    const sessions = await buildAgendaSessions(
      makeClient({ enrollments: [{ class_id: 'turma-1', student_id: OUTRO }] }),
      {
        orgId: 'org-1',
        userId: ME,
        partner: null,
        selfCheckinEnabled: false,
        enrolledClassIds: new Set<string>(),
        rows: [ROW],
        creditsBalance: 0,
        hasPlanQuota: false,
      },
    )
    expect(sessions[0].fixed).toBe(false)
    expect(sessions[0].fixedOptedOut).toBeUndefined()
  })

  it('turma lotada por outros: quem saiu vê a aula cheia (fila de espera, não entrar)', async () => {
    const [s] = await build(
      makeClient({
        enrollments: [{ class_id: 'turma-1', student_id: ME, nome: 'Eu' }],
        bookings: [
          { id: 'b1', session_id: 'sess-1', student_id: ME, status: 'cancelled', from_enrollment: true, nome: 'Eu' },
          { id: 'b3', session_id: 'sess-1', student_id: 'a', status: 'confirmed', nome: 'A' },
          { id: 'b4', session_id: 'sess-1', student_id: 'b', status: 'confirmed', nome: 'B' },
          { id: 'b5', session_id: 'sess-1', student_id: 'c', status: 'confirmed', nome: 'C' },
          { id: 'b6', session_id: 'sess-1', student_id: 'd', status: 'confirmed', nome: 'D' },
        ],
      }),
    )
    expect(s.fixed).toBe(false)
    expect(s.booked).toBe(4)
    expect(s.capacity).toBe(4)
    expect(s.booked >= s.capacity).toBe(true)
  })
})
