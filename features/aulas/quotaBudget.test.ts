import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./quotaUsage', () => ({
  getQuotaSnapshot: vi.fn(),
}))

import { computeQuotaBudget } from './quotaBudget'
import { getQuotaSnapshot } from './quotaUsage'
import type { PlanQuota } from '@/lib/utils/classQuota'

const PLANO: PlanQuota = {
  classesPerWeek: 2, cycle: 'monthly', maxClassesPerDay: 2, refundOnLateCancel: true, rolloverUnused: false,
}
const CLIENT = {} as never

describe('computeQuotaBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('devolve o remaining do getQuotaSnapshot quando cota ligada, sem parceiro, com plano', async () => {
    vi.mocked(getQuotaSnapshot).mockResolvedValue({
      limit: 8, used: 5, remaining: 3, carriedIn: 0, bookingsOnDate: 0, window: { from: '2026-07-01', to: '2026-07-31' },
    })

    const budget = await computeQuotaBudget(CLIENT, 'stu-1', 'org-1', true, PLANO, null, '2026-07-15')

    expect(budget).toBe(3)
    expect(getQuotaSnapshot).toHaveBeenCalledWith(CLIENT, 'stu-1', 'org-1', PLANO, '2026-07-15')
  })

  it('devolve null quando o aluno é parceiro, mesmo com cota ligada e plano', async () => {
    const budget = await computeQuotaBudget(CLIENT, 'stu-1', 'org-1', true, PLANO, 'wellhub', '2026-07-15')
    expect(budget).toBeNull()
    expect(getQuotaSnapshot).not.toHaveBeenCalled()
  })

  it('devolve null quando a cota está desligada', async () => {
    const budget = await computeQuotaBudget(CLIENT, 'stu-1', 'org-1', false, PLANO, null, '2026-07-15')
    expect(budget).toBeNull()
    expect(getQuotaSnapshot).not.toHaveBeenCalled()
  })

  it('devolve null quando não há plano ativo', async () => {
    const budget = await computeQuotaBudget(CLIENT, 'stu-1', 'org-1', true, null, null, '2026-07-15')
    expect(budget).toBeNull()
    expect(getQuotaSnapshot).not.toHaveBeenCalled()
  })
})
