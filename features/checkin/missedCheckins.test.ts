import { describe, it, expect, vi, beforeEach } from 'vitest'
import { brtToday } from '@/lib/utils/gridSchedule'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: vi.fn() }))
vi.mock('@/features/aulas/cancelBookings', () => ({ cancelFutureBookings: vi.fn() }))
vi.mock('./missedCheckinSettings', () => ({
  countOpenMissedCheckins: vi.fn(),
  getMissedCheckinSettings: vi.fn(),
  resolveMissedCheckinAmount: vi.fn(),
}))

import {
  ensureMissedCheckin,
  enforceMissedCheckinBlock,
  resolveOpenMissedCheckinByExtraVisit,
} from './missedCheckins'
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
    // brtToday, e não toISOString(): o código calcula "amanhã" em horário de
    // Brasília, então comparar com a data UTC fazia o teste quebrar todo dia entre
    // 21h e meia-noite BRT, quando o UTC já virou e o Brasil não.
    const hoje = brtToday(new Date())
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

describe('resolveOpenMissedCheckinByExtraVisit', () => {
  /**
   * Fake focado no que a função faz: ler a pendência aberta mais antiga, apagar o
   * payments pendente vinculado (se houver) e atualizar o status. `then` só é
   * exercitado pelo update de missed_checkins — o select termina em maybeSingle,
   * que resolve fora da cadeia thenable do builder.
   */
  function makeClient(opts: {
    pendency?: { id: string; payment_id: string | null } | null
    updateError?: { message: string } | null
  }) {
    const deletes: { table: string }[] = []
    const updates: { table: string; patch: Record<string, unknown> }[] = []

    const from = (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === 'missed_checkins') return Promise.resolve({ data: opts.pendency ?? null })
          return Promise.resolve({ data: null })
        },
        delete: () => {
          deletes.push({ table })
          return builder
        },
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch })
          return builder
        },
        then: (resolve: (v: { error: unknown }) => void) =>
          Promise.resolve({
            error: table === 'missed_checkins' ? (opts.updateError ?? null) : null,
          }).then(resolve),
      }
      return builder
    }

    return { client: { from } as never, deletes, updates }
  }

  const INPUT = {
    orgId: 'org-1',
    studentId: 'stu-1',
    partner: 'wellhub' as const,
    checkinDate: '2026-08-05',
  }

  it('sem pendência aberta, não faz nada', async () => {
    const { client, updates, deletes } = makeClient({ pendency: null })
    const r = await resolveOpenMissedCheckinByExtraVisit(client, INPUT)
    expect(r).toEqual({ resolved: false })
    expect(updates).toEqual([])
    expect(deletes).toEqual([])
  })

  it('dá baixa na pendência e apaga o payments pendente vinculado', async () => {
    const { client, updates, deletes } = makeClient({
      pendency: { id: 'mc-1', payment_id: 'pay-1' },
    })
    const r = await resolveOpenMissedCheckinByExtraVisit(client, INPUT)

    expect(r).toEqual({ resolved: true })
    expect(deletes).toEqual([{ table: 'payments' }])
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      table: 'missed_checkins',
      patch: {
        status: 'waived',
        payment_id: null,
        resolved_by: null,
        resolution_note: 'Baixa automática: check-in em 2026-08-05 sem aula vinculada.',
      },
    })
  })

  it('dá baixa mesmo sem payments vinculado (pendência sem valor configurado)', async () => {
    const { client, deletes } = makeClient({ pendency: { id: 'mc-1', payment_id: null } })
    const r = await resolveOpenMissedCheckinByExtraVisit(client, INPUT)
    expect(r).toEqual({ resolved: true })
    expect(deletes).toEqual([])
  })

  it('propaga erro do update para o caller decidir (best-effort fica no chamador)', async () => {
    const { client } = makeClient({
      pendency: { id: 'mc-1', payment_id: null },
      updateError: { message: 'db off' },
    })
    await expect(resolveOpenMissedCheckinByExtraVisit(client, INPUT)).rejects.toThrow(
      'Falha ao dar baixa automática na pendência: db off',
    )
  })
})
