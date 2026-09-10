// features/dayuse/refunds.test.ts
// openRefundForBooking mexe em dinheiro: quanto a academia deve e quanto volta
// para a carteira. Duas coisas ganham teste aqui porque errá-las custa caro —
// contar como pago o que nunca confirmou, e abrir dois estornos para a mesma
// reserva.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/features/wallet/spendWallet', () => ({
  creditWallet: vi.fn().mockResolvedValue({ balanceCents: 4000 }),
}))

import {
  openRefundForBooking,
  getBookingPayment,
  expireStalePendingDayUse,
} from './refunds'
import { creditWallet } from '@/features/wallet/spendWallet'

interface StaleBooking {
  id: string
  student_id: string
  booked_at: string
  dayuse_slots: { date: string; start_time: string } | null
}

interface FakeOpts {
  /** payments com status 'paid' desta reserva, em REAIS (como no banco). */
  paidAmounts?: number[]
  /** lançamentos de gasto da carteira, em centavos negativos. */
  walletSpends?: number[]
  /** system_settings.dayuse_refund_window_hours */
  windowHours?: string | null
  /** insert em dayuse_refunds falha com unique_violation (estorno já existe). */
  duplicateRefund?: boolean
  existingRefundId?: string
  /** Reservas pendentes vencidas devolvidas pela varredura de expiração. */
  stale?: StaleBooking[]
}

function makeClient(opts: FakeOpts = {}) {
  const inserted: Record<string, unknown>[] = []
  /** Filtros aplicados na leitura de payments, para o teste do "só pago". */
  const paymentFilters: Record<string, unknown> = {}
  /** Updates de cancelamento aplicados pela varredura. */
  const cancelled: { ids: string[]; payload: Record<string, unknown> }[] = []
  /** Filtros da varredura de expiração, para travar o corte por hold_until. */
  const staleFilters: Record<string, unknown> = {}

  const from = vi.fn((table: string) => {
    if (table === 'payments') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = (field: string, value: unknown) => {
        paymentFilters[field] = value
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: (opts.paidAmounts ?? []).map((amount) => ({ amount })),
          error: null,
        }).then(resolve)
      return b
    }
    if (table === 'wallet_transactions') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: (opts.walletSpends ?? []).map((amount_cents) => ({ amount_cents })),
          error: null,
        }).then(resolve)
      return b
    }
    if (table === 'system_settings') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.maybeSingle = () =>
        Promise.resolve({
          data: opts.windowHours == null ? null : { value: opts.windowHours },
          error: null,
        })
      return b
    }
    if (table === 'dayuse_bookings') {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.not = () => b
      b.lt = (field: string, value: unknown) => {
        staleFilters[field] = value
        return b
      }
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: opts.stale ?? [], error: null }).then(resolve)
      b.update = (payload: Record<string, unknown>) => ({
        in: (_field: string, ids: string[]) => {
          cancelled.push({ ids, payload })
          return Promise.resolve({ data: null, error: null })
        },
      })
      return b
    }
    if (table === 'dayuse_refunds') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row)
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  opts.duplicateRefund
                    ? { data: null, error: { message: 'duplicate key value violates unique constraint' } }
                    : { data: { id: 'refund-novo' }, error: null },
                ),
            }),
          }
        },
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.existingRefundId ? { id: opts.existingRefundId } : null,
                error: null,
              }),
          }),
        }),
      }
    }
    throw new Error(`tabela inesperada: ${table}`)
  })

  return { client: { from } as never, inserted, paymentFilters, cancelled, staleFilters }
}

const SLOT = { date: '2026-09-27', start_time: '09:00' }
const BASE = {
  orgId: 'org-1',
  bookingId: 'book-1',
  studentId: 'stu-1',
  slot: SLOT,
  bookedAtIso: '2026-09-01T12:00:00Z',
  // 26/09 10h BRT: 23h antes do slot, dentro de qualquer janela.
  nowIso: '2026-09-26T13:00:00Z',
}

beforeEach(() => {
  vi.mocked(creditWallet).mockClear()
})

describe('getBookingPayment', () => {
  it('soma os pagamentos em centavos e o gasto da carteira em módulo', async () => {
    const { client } = makeClient({ paidAmounts: [40, 12.5], walletSpends: [-1500] })
    await expect(getBookingPayment(client, 'book-1')).resolves.toEqual({
      gatewayCents: 5250,
      walletCents: 1500,
    })
  })

  it('conta SÓ pagamento confirmado da própria reserva', async () => {
    // Pendente que nunca confirmou não é dinheiro na mão da academia; estornar
    // o que não entrou é pagar duas vezes.
    const { client, paymentFilters } = makeClient({ paidAmounts: [40] })
    await getBookingPayment(client, 'book-1')
    expect(paymentFilters.status).toBe('paid')
    expect(paymentFilters.dayuse_booking_id).toBe('book-1')
  })

  it('não perde centavo por ponto flutuante', async () => {
    // 39.9 * 100 = 3989.9999... — sem arredondar, o estorno sairia R$ 0,01 menor.
    const { client } = makeClient({ paidAmounts: [39.9] })
    await expect(getBookingPayment(client, 'book-1')).resolves.toEqual({
      gatewayCents: 3990,
      walletCents: 0,
    })
  })
})

describe('openRefundForBooking', () => {
  it('abre estorno do valor pago quando a arena cancela', async () => {
    const { client, inserted } = makeClient({ paidAmounts: [40] })
    const r = await openRefundForBooking(client, { ...BASE, cause: 'arena_cancelou' })
    expect(r.refundId).toBe('refund-novo')
    expect(inserted[0]).toMatchObject({
      booking_id: 'book-1',
      amount_cents: 4000,
      cause: 'arena_cancelou',
      method: 'pix',
      status: 'pendente',
    })
  })

  it('não abre estorno para reserva sem pagamento', async () => {
    const { client, inserted } = makeClient({ paidAmounts: [] })
    const r = await openRefundForBooking(client, { ...BASE, cause: 'arena_cancelou' })
    expect(r.refundId).toBeNull()
    expect(r.eligibility.due).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('aluno cancelando fora da janela não gera estorno', async () => {
    // 27/09 07h BRT = 2h antes do slot; janela default 5h.
    const { client, inserted } = makeClient({ paidAmounts: [40] })
    const r = await openRefundForBooking(client, {
      ...BASE, nowIso: '2026-09-27T10:00:00Z', cause: 'aluno_cancelou',
    })
    expect(r.refundId).toBeNull()
    expect(r.eligibility.denyReason).toContain('fora do prazo')
    expect(inserted).toHaveLength(0)
  })

  it('respeita a janela configurada pela academia', async () => {
    const { client } = makeClient({ paidAmounts: [40], windowHours: '1' })
    const r = await openRefundForBooking(client, {
      ...BASE, nowIso: '2026-09-27T10:00:00Z', cause: 'aluno_cancelou',
    })
    expect(r.refundId).toBe('refund-novo')
  })

  it('devolve a parte da carteira para a carteira, sem colocá-la no estorno', async () => {
    const { client, inserted } = makeClient({ paidAmounts: [25], walletSpends: [-1500] })
    const r = await openRefundForBooking(client, { ...BASE, cause: 'arena_cancelou' })
    expect(r.walletRestoredCents).toBe(1500)
    expect(creditWallet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      cents: 1500,
      sourceTable: 'dayuse_bookings',
      sourceId: 'book-1',
    }))
    // O estorno cobre só o que entrou por gateway.
    expect(inserted[0]).toMatchObject({ amount_cents: 2500 })
  })

  it('reserva paga só com carteira não abre estorno nenhum', async () => {
    const { client, inserted } = makeClient({ paidAmounts: [], walletSpends: [-4000] })
    const r = await openRefundForBooking(client, { ...BASE, cause: 'arena_cancelou' })
    expect(r.walletRestoredCents).toBe(4000)
    expect(r.refundId).toBeNull()
    expect(inserted).toHaveLength(0)
  })

  it('chamada duas vezes devolve o estorno existente em vez de criar o segundo', async () => {
    // É o índice único de booking_id que garante isso no banco; aqui se trava o
    // tratamento — cancelamento em massa repetido não pode dobrar a dívida.
    const { client } = makeClient({
      paidAmounts: [40], duplicateRefund: true, existingRefundId: 'refund-antigo',
    })
    const r = await openRefundForBooking(client, { ...BASE, cause: 'arena_cancelou' })
    expect(r.refundId).toBe('refund-antigo')
  })

  it('copia a chave PIX da reserva para o estorno', async () => {
    const { client, inserted } = makeClient({ paidAmounts: [40] })
    await openRefundForBooking(client, {
      ...BASE, cause: 'arena_cancelou', pixKey: '11999990000', pixOwner: 'Maria',
    })
    expect(inserted[0]).toMatchObject({ pix_key: '11999990000', pix_owner: 'Maria' })
  })
})

describe('expireStalePendingDayUse', () => {
  const stale: StaleBooking[] = [{
    id: 'book-1',
    student_id: 'stu-1',
    booked_at: '2026-09-26T13:00:00Z',
    dayuse_slots: SLOT,
  }]

  it('cancela a reserva vencida E devolve o saldo que ela debitou', async () => {
    // O update em massa que existia aqui liberava a vaga e deixava o saldo
    // debitado: quem abatia crédito e abandonava o checkout ficava sem os dois.
    const { client, cancelled } = makeClient({ stale, walletSpends: [-4000] })
    const r = await expireStalePendingDayUse(client, 'org-1')
    expect(r.expired).toBe(1)
    expect(r.walletRestoredCents).toBe(4000)
    expect(cancelled[0].ids).toEqual(['book-1'])
    expect(cancelled[0].payload).toMatchObject({ status: 'cancelled' })
    expect(creditWallet).toHaveBeenCalledTimes(1)
  })

  it('não abre estorno: o pagamento nunca confirmou', async () => {
    const { client, inserted } = makeClient({ stale, walletSpends: [-4000] })
    await expireStalePendingDayUse(client, 'org-1')
    expect(inserted).toHaveLength(0)
  })

  it('corta por hold_until, não por booked_at', async () => {
    // Filtrar por booked_at daria 30 min a todos e mataria o PIX manual antes
    // de a arena conferir o comprovante (a janela dele é 24h).
    const { client, staleFilters } = makeClient({ stale })
    await expireStalePendingDayUse(client, 'org-1')
    expect(Object.keys(staleFilters)).toEqual(['hold_until'])
  })

  it('sem reserva vencida não escreve nada', async () => {
    const { client, cancelled } = makeClient({ stale: [] })
    const r = await expireStalePendingDayUse(client, 'org-1')
    expect(r).toEqual({ expired: 0, walletRestoredCents: 0 })
    expect(cancelled).toHaveLength(0)
  })
})
