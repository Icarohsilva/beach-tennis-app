// lib/billing/mpClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  mpExchangeOAuthCode,
  mpRefreshOAuthToken,
  mpCreatePreapproval,
  mpGetPreapproval,
  mpCancelPreapproval,
  mpGetAuthorizedPayment,
  mpCreatePreference,
  mpGetPayment,
} from './mpClient'

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
  process.env.MP_APP_ID = 'app-id-test'
  process.env.MP_APP_SECRET = 'app-secret-test'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mpExchangeOAuthCode', () => {
  it('troca code por tokens e converte expires_in em expiresAt', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: 'APP_USR-abc',
      refresh_token: 'TG-def',
      user_id: 12345,
      public_key: 'pk-test',
      expires_in: 15552000,
    }))
    const tokens = await mpExchangeOAuthCode('code-1', 'https://site/callback')
    expect(tokens.accessToken).toBe('APP_USR-abc')
    expect(tokens.refreshToken).toBe('TG-def')
    expect(tokens.mpUserId).toBe('12345')
    expect(tokens.publicKey).toBe('pk-test')
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/oauth/token')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.grant_type).toBe('authorization_code')
    expect(body.client_id).toBe('app-id-test')
    expect(body.code).toBe('code-1')
    expect(body.redirect_uri).toBe('https://site/callback')
  })

  it('resposta não-ok → lança com status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'invalid_grant' }, 400))
    await expect(mpExchangeOAuthCode('code-x', 'https://site/cb')).rejects.toThrow(/400/)
  })
})

describe('mpRefreshOAuthToken', () => {
  it('usa grant_type refresh_token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: 'novo', refresh_token: 'novo-rt', user_id: 9, expires_in: 100,
    }))
    const tokens = await mpRefreshOAuthToken('rt-antigo')
    expect(tokens.accessToken).toBe('novo')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('rt-antigo')
  })
})

describe('preapproval', () => {
  it('mpCreatePreapproval envia Authorization do vendedor e retorna id/init_point', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', init_point: 'https://mp/checkout' }))
    const res = await mpCreatePreapproval('seller-token', {
      reason: 'Plano 2x — Mensal',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 199.9, currency_id: 'BRL' },
      payer_email: 'aluno@x.com',
      back_url: 'https://site',
      external_reference: 'sub-1',
      status: 'pending',
    })
    expect(res).toEqual({ id: 'pre-1', init_point: 'https://mp/checkout' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer seller-token' })
  })

  it('mpGetPreapproval faz GET no id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', status: 'authorized' }))
    const pre = await mpGetPreapproval('tok', 'pre-1')
    expect(pre.status).toBe('authorized')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/preapproval/pre-1')
  })

  it('mpCancelPreapproval faz PUT status cancelled', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pre-1', status: 'cancelled' }))
    await mpCancelPreapproval('tok', 'pre-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.mercadopago.com/preapproval/pre-1')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: 'cancelled' })
  })
})

describe('pagamentos', () => {
  it('mpGetAuthorizedPayment faz GET no recurso', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      preapproval_id: 'pre-1', status: 'processed', payment: { id: 77, status: 'approved' },
    }))
    const ap = await mpGetAuthorizedPayment('tok', '55')
    expect(ap.preapproval_id).toBe('pre-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/authorized_payments/55')
  })

  it('mpGetPayment faz GET /v1/payments/:id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 99, status: 'approved', external_reference: 'pay-row-1', transaction_amount: 50,
    }))
    const pay = await mpGetPayment('tok', '99')
    expect(pay.external_reference).toBe('pay-row-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/v1/payments/99')
  })

  it('mpCreatePreference retorna id/init_point', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'pref-1', init_point: 'https://mp/pref' }))
    const res = await mpCreatePreference('tok', {
      items: [{ title: 'Aula avulsa (2x)', quantity: 2, unit_price: 40, currency_id: 'BRL' }],
      external_reference: 'pay-row-1',
      notification_url: 'https://site/api/webhooks/mercadopago?org=o1',
      back_urls: { success: 'https://site', pending: 'https://site', failure: 'https://site' },
      marketplace_fee: 0,
    })
    expect(res).toEqual({ id: 'pref-1', init_point: 'https://mp/pref' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadopago.com/checkout/preferences')
  })
})
