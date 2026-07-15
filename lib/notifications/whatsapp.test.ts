import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsApp, normalizePhone } from './whatsapp'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  process.env.ZAPI_INSTANCE_ID = 'inst-test'
  process.env.ZAPI_TOKEN = 'token-test'
  process.env.ZAPI_CLIENT_TOKEN = 'client-token-test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizePhone', () => {
  it('remove nao-digitos e adiciona DDI 55 se ausente', () => {
    expect(normalizePhone('(11) 98888-7777')).toBe('5511988887777')
  })
  it('nao duplica DDI 55 se ja presente', () => {
    expect(normalizePhone('5511988887777')).toBe('5511988887777')
  })
})

describe('sendWhatsApp', () => {
  it('fail-closed sem ZAPI_INSTANCE_ID', async () => {
    delete process.env.ZAPI_INSTANCE_ID
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fail-closed sem ZAPI_TOKEN', async () => {
    delete process.env.ZAPI_TOKEN
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fail-closed sem ZAPI_CLIENT_TOKEN', async () => {
    delete process.env.ZAPI_CLIENT_TOKEN
    await sendWhatsApp({ phone: '11988887777', message: 'oi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('monta URL, header Client-Token e telefone normalizado', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ zaapId: 'z1' }))
    await sendWhatsApp({ phone: '(11) 98888-7777', message: '*Titulo*\n\nCorpo' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.z-api.io/instances/inst-test/token/token-test/send-text')
    expect((init as RequestInit).headers).toMatchObject({ 'Client-Token': 'client-token-test' })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.phone).toBe('5511988887777')
    expect(body.message).toBe('*Titulo*\n\nCorpo')
  })
  it('resposta nao-ok lanca', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 400))
    await expect(sendWhatsApp({ phone: '11988887777', message: 'oi' })).rejects.toThrow(/400/)
  })
})
