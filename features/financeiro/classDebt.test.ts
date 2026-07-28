// features/financeiro/classDebt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureClassDebt } from './classDebt'

/**
 * Stub do client Supabase. Cada tabela devolve o que o teste configurar.
 * `inserted` acumula o que foi gravado em payments.
 */
function makeClient(opts: {
  booking?: { credit_used: boolean } | null
  membership?: { partner: string | null } | null
  subscription?:
    | {
        gateway?: string
        current_period_end: string | null
        subscription_plans?: {
          classes_per_week: number
          cycle: string
          max_classes_per_day: number
          refund_on_late_cancel: boolean
        }
      }
    | null
  price?: string | null
  insertError?: { code: string } | null
}) {
  const inserted: Record<string, unknown>[] = []

  const from = vi.fn((table: string) => {
    if (table === 'payments') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => {
          if (opts.insertError) return Promise.resolve({ error: opts.insertError })
          inserted.push(row)
          return Promise.resolve({ error: null })
        }),
      }
    }

    const single = () => {
      if (table === 'session_bookings') return Promise.resolve({ data: opts.booking ?? null })
      if (table === 'memberships') return Promise.resolve({ data: opts.membership ?? null })
      if (table === 'student_subscriptions')
        return Promise.resolve({ data: opts.subscription ?? null })
      return Promise.resolve({ data: null })
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      maybeSingle: single,
      single,
      then: (resolve: (v: unknown) => void) => {
        if (table === 'system_settings') {
          const data = opts.price === null ? [] : [{ key: 'single_class_price', value: opts.price }]
          return Promise.resolve({ data }).then(resolve)
        }
        return Promise.resolve({ data: [] }).then(resolve)
      },
    }
    return builder
  })

  return { client: { from } as never, inserted }
}

const args = { orgId: 'org-1', studentId: 'stu-1', sessionId: 'ses-1' }

describe('ensureClassDebt', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('cria pendência para aluno sem plano, sem parceiro e sem crédito usado', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      organization_id: 'org-1',
      student_id: 'stu-1',
      session_id: 'ses-1',
      amount: 60,
      status: 'pending',
      type: 'per_class',
      gateway: 'manual',
      credits_qty: null,
    })
  })

  it('não cria pendência quando a reserva foi paga com crédito', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: true },
      membership: { partner: null },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('não cria pendência para aluno de parceiro', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: 'wellhub' },
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('não cria pendência para aluno com plano vigente', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: {
        gateway: 'mercadopago',
        current_period_end: '2099-01-01T00:00:00Z',
        subscription_plans: {
          classes_per_week: 2,
          cycle: 'monthly',
          max_classes_per_day: 2,
          refund_on_late_cancel: true,
        },
      },
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })

  it('cria pendência para plano com período vencido', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: { gateway: 'mercadopago', current_period_end: '2020-01-01T00:00:00Z' },
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(1)
  })

  it('cria pendência com amount 0 quando o preço não está configurado', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: null,
    })

    await ensureClassDebt(client, args)
    expect(inserted[0]).toMatchObject({ amount: 0 })
  })

  it('violação do unique (23505) não lança — presença marcada duas vezes cobra uma', async () => {
    const { client } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
      insertError: { code: '23505' },
    })

    await expect(ensureClassDebt(client, args)).resolves.toBeUndefined()
  })

  it('erro de insert que não seja 23505 lança', async () => {
    const { client } = makeClient({
      booking: { credit_used: false },
      membership: { partner: null },
      subscription: null,
      price: '60',
      insertError: { code: '42501' },
    })

    await expect(ensureClassDebt(client, args)).rejects.toThrow()
  })

  it('sem membership não cria nada (aluno não é desta academia)', async () => {
    const { client, inserted } = makeClient({
      booking: { credit_used: false },
      membership: null,
      subscription: null,
      price: '60',
    })

    await ensureClassDebt(client, args)
    expect(inserted).toHaveLength(0)
  })
})
