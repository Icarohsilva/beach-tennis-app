import { describe, it, expect, vi, beforeEach } from 'vitest'

const setVapidDetails = vi.fn()
const sendNotification = vi.fn()

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}))

import { sendPush } from './push'

const subscription = { endpoint: 'https://push.example/abc', p256dh: 'p256', auth: 'authk' }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:x@y.com'
})

describe('sendPush', () => {
  it('retorna skipped quando faltam chaves VAPID', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('skipped')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('retorna ok no sucesso', async () => {
    sendNotification.mockResolvedValue(undefined)
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('ok')
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('retorna expired quando o serviço responde 410', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('expired')
  })

  it('retorna expired quando o serviço responde 404', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }))
    const r = await sendPush({ subscription, title: 't', body: 'b' })
    expect(r).toBe('expired')
  })

  it('relança em outros erros', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }))
    await expect(sendPush({ subscription, title: 't', body: 'b' })).rejects.toThrow('boom')
  })
})
