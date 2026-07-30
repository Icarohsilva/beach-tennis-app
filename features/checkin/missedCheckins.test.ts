import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: vi.fn() }))
vi.mock('@/features/aulas/cancelBookings', () => ({ cancelFutureBookings: vi.fn() }))
vi.mock('./missedCheckinSettings', () => ({
  countOpenMissedCheckins: vi.fn(),
  getMissedCheckinSettings: vi.fn(),
  resolveMissedCheckinAmount: vi.fn(),
}))

import { ensureMissedCheckin, enforceMissedCheckinBlock } from './missedCheckins'
import { cancelFutureBookings } from '@/features/aulas/cancelBookings'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
  resolveMissedCheckinAmount,
} from './missedCheckinSettings'

/**
 * Fake client focado no que ensureMissedCheckin realmente faz: decidir se cria, e o
 * que grava. Registra os inserts pra provar que a cobrança órfã não nasce.
 */
function makeClient(opts: {
  partner?: string | null
  checkinsOnDate?: number
  existingPendency?: { id: string } | null
}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = []

  const from = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      insert(row: Record<string, unknown>) {
        inserts.push({ table, row })
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: `${table}-novo` }, error: null }),
          }),
        }
      },
      maybeSingle: () => {
        if (table === 'memberships') {
          return Promise.resolve({ data: { partner: opts.partner ?? null } })
        }
        if (table === 'missed_checkins') {
          return Promise.resolve({ data: opts.existingPendency ?? null })
        }
        return Promise.resolve({ data: null })
      },
      then(resolve: (v: { count: number; data: unknown[] }) => void) {
        // Só `checkins` chega aqui, via { count: 'exact', head: true }.
        return Promise.resolve({ count: opts.checkinsOnDate ?? 0, data: [] }).then(resolve)
      },
    }
    return builder
  }

  return { client: { from } as never, inserts }
}

const INPUT = {
  orgId: 'org-1',
  studentId: 'stu-1',
  sessionId: 'sess-1',
  sessionDate: '2026-07-30',
  createdBy: null,
}

describe('ensureMissedCheckin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(countOpenMissedCheckins).mockResolvedValue(1)
    vi.mocked(resolveMissedCheckinAmount).mockResolvedValue(10)
  })

  it('aluno sem parceiro não gera pendência nem cobrança', async () => {
    const { client, inserts } = makeClient({ partner: null })
    const r = await ensureMissedCheckin(client, INPUT)
    expect(r).toEqual({ created: false, openCount: 0 })
    expect(inserts).toEqual([])
  })

  it('já fez check-in na data: o repasse veio, nada a cobrar', async () => {
    const { client, inserts } = makeClient({ partner: 'wellhub', checkinsOnDate: 1 })
    const r = await ensureMissedCheckin(client, INPUT)
    expect(r.created).toBe(false)
    expect(inserts).toEqual([])
  })

  it('cria a pendência e o payments quando há valor', async () => {
    const { client, inserts } = makeClient({ partner: 'wellhub' })
    const r = await ensureMissedCheckin(client, INPUT)

    expect(r.created).toBe(true)
    expect(inserts.map((i) => i.table)).toEqual(['payments', 'missed_checkins'])
    expect(inserts[0].row).toMatchObject({ missed_checkin: true, amount: 10, status: 'pending' })
    expect(inserts[1].row).toMatchObject({
      partner: 'wellhub',
      session_date: '2026-07-30',
      amount: 10,
      status: 'open',
      payment_id: 'payments-novo',
    })
  })

  it('valor 0 cria só o registro de controle, sem cobrança', async () => {
    vi.mocked(resolveMissedCheckinAmount).mockResolvedValue(0)
    const { client, inserts } = makeClient({ partner: 'wellhub' })
    const r = await ensureMissedCheckin(client, INPUT)

    expect(r.created).toBe(true)
    expect(inserts.map((i) => i.table)).toEqual(['missed_checkins'])
    expect(inserts[0].row).toMatchObject({ amount: 0, payment_id: null })
  })

  it('pendência já existente (inclusive perdoada) não cria cobrança órfã', async () => {
    // Regressão: perdoar apaga o payments. Se a idempotência dependesse do 23505 do
    // índice único, marcar ausente de novo criaria um payments sem pendência
    // vinculada — invisível nas telas e cobrando um check-in já perdoado.
    const { client, inserts } = makeClient({
      partner: 'wellhub',
      existingPendency: { id: 'ja-existe' },
    })
    const r = await ensureMissedCheckin(client, INPUT)

    expect(r.created).toBe(false)
    expect(inserts).toEqual([])
  })
})

describe('enforceMissedCheckinBlock', () => {
  const client = { from: () => ({}) } as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cancelFutureBookings).mockResolvedValue({ cancelled: 0, freedSessionIds: [] })
  })

  it('limite 0 (desligado) não cancela nada', async () => {
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 0, price: 0 })
    const r = await enforceMissedCheckinBlock(client, { orgId: 'org-1', studentId: 'stu-1' })

    expect(r).toEqual({ blocked: false, cancelledBookings: 0 })
    expect(cancelFutureBookings).not.toHaveBeenCalled()
    expect(countOpenMissedCheckins).not.toHaveBeenCalled()
  })

  it('abaixo do limite não cancela nada', async () => {
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 3, price: 10 })
    vi.mocked(countOpenMissedCheckins).mockResolvedValue(2)
    const r = await enforceMissedCheckinBlock(client, { orgId: 'org-1', studentId: 'stu-1' })

    expect(r).toEqual({ blocked: false, cancelledBookings: 0 })
    expect(cancelFutureBookings).not.toHaveBeenCalled()
  })

  it('no limite cancela a partir de AMANHÃ, poupando a chamada de hoje', async () => {
    // Regressão: cancelar a sessão de hoje tiraria o aluno do roster da chamada em
    // curso (o roster exclui reserva 'cancelled'), fazendo-o desaparecer da lista
    // logo depois de o professor marcar ausente.
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 2, price: 10 })
    vi.mocked(countOpenMissedCheckins).mockResolvedValue(2)

    await enforceMissedCheckinBlock(client, { orgId: 'org-1', studentId: 'stu-1' })

    const call = vi.mocked(cancelFutureBookings).mock.calls[0][1]
    expect(call).toMatchObject({ studentId: 'stu-1', orgId: 'org-1', onlyFromEnrollment: false })
    const hoje = new Date().toISOString().slice(0, 10)
    expect(call.from).toBeDefined()
    expect(call.from! > hoje).toBe(true)
  })

  it('cancela fixa e avulsa — o objetivo é liberar a vaga', async () => {
    vi.mocked(getMissedCheckinSettings).mockResolvedValue({ blockLimit: 1, price: 10 })
    vi.mocked(countOpenMissedCheckins).mockResolvedValue(1)

    await enforceMissedCheckinBlock(client, { orgId: 'org-1', studentId: 'stu-1' })

    expect(vi.mocked(cancelFutureBookings).mock.calls[0][1].onlyFromEnrollment).toBe(false)
  })

  it('falha interna não propaga — a marcação de presença não pode cair', async () => {
    vi.mocked(getMissedCheckinSettings).mockRejectedValue(new Error('boom'))
    const r = await enforceMissedCheckinBlock(client, { orgId: 'org-1', studentId: 'stu-1' })
    expect(r).toEqual({ blocked: false, cancelledBookings: 0 })
  })
})
