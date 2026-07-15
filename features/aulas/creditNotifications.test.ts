import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/dispatch', () => ({ notifyUsers: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { checkLowCreditThreshold } from './creditNotifications'
import { notifyUsers } from '@/lib/notifications/dispatch'

function makeFakeClient(opts: {
  creditsBalance: number
  phone?: string | null
  email?: string | null
}) {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.single = () => {
        if (table === 'memberships') return Promise.resolve({ data: { credits_balance: opts.creditsBalance } })
        if (table === 'profiles') return Promise.resolve({ data: { phone: opts.phone ?? null } })
        return Promise.resolve({ data: null })
      }
      builder.maybeSingle = () => {
        if (table === 'user_emails') return Promise.resolve({ data: opts.email ? { email: opts.email } : null })
        return Promise.resolve({ data: null })
      }
      return builder
    },
  }
  return client as never
}

describe('checkLowCreditThreshold', () => {
  beforeEach(() => {
    vi.mocked(notifyUsers).mockReset()
  })

  it('dispara quando o debito cruzou de >1 para 1', async () => {
    const client = makeFakeClient({ creditsBalance: 1, phone: '11988887777', email: 'a@x.com' })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).toHaveBeenCalledTimes(1)
    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({
      orgId: 'org-1',
      type: 'low_credits',
      recipients: [{ userId: 'student-1', email: 'a@x.com', phone: '11988887777' }],
      channels: ['inapp', 'email', 'whatsapp', 'push'],
    }))
  })

  it('nao dispara quando o saldo permanece alto apos o debito', async () => {
    const client = makeFakeClient({ creditsBalance: 4 })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('nao dispara se caiu a 0', async () => {
    const client = makeFakeClient({ creditsBalance: 0 })
    await checkLowCreditThreshold(client, 'student-1', 'org-1', -1)
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('nunca lanca mesmo se notifyUsers falhar', async () => {
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error('boom'))
    const client = makeFakeClient({ creditsBalance: 1 })
    await expect(checkLowCreditThreshold(client, 'student-1', 'org-1', -1)).resolves.toBeUndefined()
  })
})
