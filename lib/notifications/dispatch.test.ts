import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./email', () => ({ sendEmail: vi.fn() }))
vi.mock('./whatsapp', () => ({ sendWhatsApp: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { notifyUsers } from './dispatch'
import { sendEmail } from './email'
import { sendWhatsApp } from './whatsapp'
import * as Sentry from '@sentry/nextjs'

function makeFakeClient(opts: { insertError?: { message: string } } = {}) {
  const inserted: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      return {
        insert: (rows: unknown[]) => {
          inserted[table] = rows as unknown[]
          return Promise.resolve({ error: opts.insertError ?? null })
        },
      }
    },
  }
  return { client: client as never, inserted }
}

describe('notifyUsers', () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset()
    vi.mocked(sendWhatsApp).mockReset()
    vi.mocked(Sentry.captureException).mockReset()
  })

  it('sem destinatarios nao faz nada', async () => {
    const { client } = makeFakeClient()
    await notifyUsers(client, {
      orgId: 'org-1', recipients: [], type: 'admin_message', title: 'T', body: 'B',
      channels: ['inapp', 'email', 'whatsapp'],
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendWhatsApp).not.toHaveBeenCalled()
  })

  it('insere em notifications quando channels inclui inapp', async () => {
    const { client, inserted } = makeFakeClient()
    await notifyUsers(client, {
      orgId: 'org-1', recipients: [{ userId: 'u1' }], type: 'waitlist_offer',
      title: 'Vaga disponivel!', body: 'Corpo', channels: ['inapp'],
    })
    expect(inserted.notifications).toEqual([
      { organization_id: 'org-1', user_id: 'u1', type: 'waitlist_offer', title: 'Vaga disponivel!', body: 'Corpo', read: false },
    ])
  })

  it('insert falhando lanca (in-app e o canal garantido)', async () => {
    const { client } = makeFakeClient({ insertError: { message: 'db down' } })
    await expect(
      notifyUsers(client, {
        orgId: 'org-1', recipients: [{ userId: 'u1' }], type: 'admin_message',
        title: 'T', body: 'B', channels: ['inapp'],
      }),
    ).rejects.toThrow(/db down/)
  })

  it('chama sendEmail so para destinatarios com email', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendEmail).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [{ userId: 'u1', email: 'a@x.com' }, { userId: 'u2' }],
      type: 'low_credits', title: 'T', body: 'B', channels: ['email'],
    })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith({ to: 'a@x.com', subject: 'T', html: expect.stringContaining('B') })
  })

  it('chama sendWhatsApp so para destinatarios com phone', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendWhatsApp).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [{ userId: 'u1', phone: '11988887777' }, { userId: 'u2' }],
      type: 'class_cancelled', title: 'T', body: 'B', channels: ['whatsapp'],
    })
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(sendWhatsApp).toHaveBeenCalledWith({ phone: '11988887777', message: '*T*\n\nB' })
  })

  it('falha em um email nao impede os demais nem o whatsapp e reporta ao Sentry', async () => {
    const { client } = makeFakeClient()
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('smtp fail')).mockResolvedValueOnce(undefined)
    vi.mocked(sendWhatsApp).mockResolvedValue(undefined)
    await notifyUsers(client, {
      orgId: 'org-1',
      recipients: [
        { userId: 'u1', email: 'a@x.com', phone: '11988887777' },
        { userId: 'u2', email: 'b@x.com' },
      ],
      type: 'payment_past_due', title: 'T', body: 'B', channels: ['email', 'whatsapp'],
    })
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { channel: 'email', notificationType: 'payment_past_due' } }),
    )
  })
})
