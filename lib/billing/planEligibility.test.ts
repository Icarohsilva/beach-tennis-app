import { describe, it, expect } from 'vitest'
import { hasActiveSubscriptionPlan, getActivePlan } from './planEligibility'

function makeClient(
  sub:
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
    | null,
) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: sub }),
  }
  return { from: () => builder } as never
}

describe('hasActiveSubscriptionPlan', () => {
  it('sem assinatura ativa devolve false', async () => {
    expect(await hasActiveSubscriptionPlan(makeClient(null), 'stu-1', 'org-1')).toBe(false)
  })

  it('mercadopago com período vigente devolve true', async () => {
    const client = makeClient({
      gateway: 'mercadopago',
      current_period_end: '2099-01-01T00:00:00Z',
      subscription_plans: {
        classes_per_week: 2,
        cycle: 'monthly',
        max_classes_per_day: 2,
        refund_on_late_cancel: true,
      },
    })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })

  it('mercadopago com período vencido devolve false', async () => {
    const client = makeClient({ gateway: 'mercadopago', current_period_end: '2020-01-01T00:00:00Z' })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(false)
  })

  it('gateway manual é sempre vigente (gerido por fora)', async () => {
    const client = makeClient({
      gateway: 'manual',
      current_period_end: null,
      subscription_plans: {
        classes_per_week: 2,
        cycle: 'monthly',
        max_classes_per_day: 2,
        refund_on_late_cancel: true,
      },
    })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })

  it('gateway ausente (undefined) também é sempre vigente — mesma regra de isSubscriptionCurrent', async () => {
    const client = makeClient({
      current_period_end: null,
      subscription_plans: {
        classes_per_week: 2,
        cycle: 'monthly',
        max_classes_per_day: 2,
        refund_on_late_cancel: true,
      },
    })
    expect(await hasActiveSubscriptionPlan(client, 'stu-1', 'org-1')).toBe(true)
  })
})

describe('getActivePlan', () => {
  it('devolve a configuração de cota do plano vigente', async () => {
    const client = makeClient({
      gateway: 'manual',
      current_period_end: null,
      subscription_plans: {
        classes_per_week: 2,
        cycle: 'monthly',
        max_classes_per_day: 2,
        refund_on_late_cancel: true,
      },
    })

    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toEqual({
      classesPerWeek: 2,
      cycle: 'monthly',
      maxClassesPerDay: 2,
      refundOnLateCancel: true,
    })
  })

  it('devolve null quando não há assinatura ativa', async () => {
    const client = makeClient(null)
    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toBeNull()
  })

  it('devolve null quando a assinatura está ativa mas o período venceu', async () => {
    const client = makeClient({
      gateway: 'mercadopago',
      current_period_end: '2020-01-01T00:00:00Z',
      subscription_plans: {
        classes_per_week: 2,
        cycle: 'monthly',
        max_classes_per_day: 2,
        refund_on_late_cancel: true,
      },
    })
    await expect(getActivePlan(client, 'stu-1', 'org-1')).resolves.toBeNull()
  })
})
