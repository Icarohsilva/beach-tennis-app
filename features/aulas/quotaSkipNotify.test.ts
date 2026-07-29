import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/notifications/dispatch', () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
}))

import { notifyQuotaSkips } from './quotaSkipNotify'
import { notifyUsers } from '@/lib/notifications/dispatch'

function makeClient(admins: { user_id: string }[], students: { id: string; full_name: string }[]) {
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (resolve: (v: { data: unknown }) => void) => {
        const data = table === 'memberships' ? admins : table === 'profiles' ? students : []
        return Promise.resolve({ data }).then(resolve)
      },
    }
    return builder
  })
  return { from } as never
}

describe('notifyQuotaSkips', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista vazia não faz nada', async () => {
    await notifyQuotaSkips([])
    expect(notifyUsers).not.toHaveBeenCalled()
  })

  it('notifica o aluno individualmente e os admins com um resumo', async () => {
    const client = makeClient(
      [{ user_id: 'admin-1' }],
      [{ id: 'stu-1', full_name: 'Fulano' }],
    )

    await notifyQuotaSkips(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
      client,
    )

    expect(notifyUsers).toHaveBeenCalledTimes(2)
    expect(notifyUsers).toHaveBeenNthCalledWith(1, client, expect.objectContaining({
      orgId: 'org-1',
      recipients: [{ userId: 'stu-1' }],
      type: 'fixa_sem_cota',
      channels: ['push', 'inapp'],
    }))
    expect(notifyUsers).toHaveBeenNthCalledWith(2, client, expect.objectContaining({
      orgId: 'org-1',
      recipients: [{ userId: 'admin-1' }],
      type: 'fixa_sem_cota_admin',
      channels: ['inapp'],
      body: expect.stringContaining('Fulano'),
    }))
  })

  it('sem admin na academia, não tenta notificar admin (mas notifica o aluno)', async () => {
    const client = makeClient([], [{ id: 'stu-1', full_name: 'Fulano' }])

    await notifyQuotaSkips(
      [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
      client,
    )

    expect(notifyUsers).toHaveBeenCalledTimes(1)
    expect(notifyUsers).toHaveBeenCalledWith(client, expect.objectContaining({ type: 'fixa_sem_cota' }))
  })

  it('erro em notifyUsers não propaga (best-effort)', async () => {
    vi.mocked(notifyUsers).mockRejectedValueOnce(new Error('boom'))
    const client = makeClient([{ user_id: 'admin-1' }], [{ id: 'stu-1', full_name: 'Fulano' }])
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyQuotaSkips(
        [{ studentId: 'stu-1', classId: 'class-1', className: 'Turma Terça', orgId: 'org-1' }],
        client,
      ),
    ).resolves.toBeUndefined()

    expect(consoleErrorSpy).toHaveBeenCalled()
  })
})
