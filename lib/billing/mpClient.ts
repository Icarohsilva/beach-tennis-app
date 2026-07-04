// lib/billing/mpClient.ts
// Cliente HTTP da API do Mercado Pago. ÚNICO lugar do app com fetch para
// api.mercadopago.com. Todas as funções recebem o token do CALLER — pode ser
// o token OAuth de uma academia (billing aluno→academia) ou o da plataforma
// (billing SaaS). Erros HTTP viram Error com status + corpo truncado; quem
// decide retry/mensagem amigável é o caller.
const MP_BASE = 'https://api.mercadopago.com'

// Erro tipado (não só string) para o caller distinguir falha transitória
// (5xx/rede → vale retry) de falha de autorização (401/403 → token/refresh
// realmente revogado, ex. no cron de renovação). status=0 quando o fetch em
// si falhou (rede/DNS), sem resposta HTTP nenhuma.
export class MpApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MpApiError'
  }
}

async function mpFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${MP_BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new MpApiError(
      `MP ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`,
      res.status,
    )
  }
  return (await res.json()) as T
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ── OAuth (marketplace) ──────────────────────────────────────────────────────

export interface MpOAuthTokens {
  accessToken: string
  refreshToken: string
  mpUserId: string
  publicKey: string | null
  expiresAt: string
}

interface RawOAuthResponse {
  access_token: string
  refresh_token: string
  user_id: number | string
  public_key?: string
  expires_in: number
}

function toTokens(raw: RawOAuthResponse, now = Date.now()): MpOAuthTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    mpUserId: String(raw.user_id),
    publicKey: raw.public_key ?? null,
    expiresAt: new Date(now + raw.expires_in * 1000).toISOString(),
  }
}

export async function mpExchangeOAuthCode(code: string, redirectUri: string): Promise<MpOAuthTokens> {
  const raw = await mpFetch<RawOAuthResponse>('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.MP_APP_ID,
      client_secret: process.env.MP_APP_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  })
  return toTokens(raw)
}

export async function mpRefreshOAuthToken(refreshToken: string): Promise<MpOAuthTokens> {
  const raw = await mpFetch<RawOAuthResponse>('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.MP_APP_ID,
      client_secret: process.env.MP_APP_SECRET,
      refresh_token: refreshToken,
    }),
  })
  return toTokens(raw)
}

// ── Assinaturas (preapproval) ────────────────────────────────────────────────

export interface MpPreapprovalCreate {
  reason: string
  auto_recurring: {
    frequency: number
    frequency_type: 'months'
    transaction_amount: number
    currency_id: 'BRL'
  }
  payer_email: string
  back_url: string
  external_reference: string
  notification_url?: string
  status: 'pending'
}

export interface MpPreapproval {
  id: string
  status?: string
  external_reference?: string
  init_point?: string
}

export async function mpCreatePreapproval(
  token: string,
  body: MpPreapprovalCreate,
): Promise<{ id: string; init_point: string }> {
  const data = await mpFetch<MpPreapproval>('/preapproval', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!data.id || !data.init_point) throw new Error('MP preapproval sem id/init_point')
  return { id: data.id, init_point: data.init_point }
}

export async function mpGetPreapproval(token: string, id: string): Promise<MpPreapproval> {
  return mpFetch<MpPreapproval>(`/preapproval/${id}`, { headers: authHeaders(token) })
}

export async function mpCancelPreapproval(token: string, id: string): Promise<void> {
  await mpFetch<MpPreapproval>(`/preapproval/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ status: 'cancelled' }),
  })
}

// ── Cobranças recorrentes (authorized_payments) ─────────────────────────────

export interface MpAuthorizedPayment {
  preapproval_id?: string
  status?: string
  payment?: { id?: number; status?: string }
}

export async function mpGetAuthorizedPayment(token: string, id: string): Promise<MpAuthorizedPayment> {
  return mpFetch<MpAuthorizedPayment>(`/authorized_payments/${id}`, { headers: authHeaders(token) })
}

// ── Checkout Pro (avulso / day use) ──────────────────────────────────────────

export interface MpPreferenceCreate {
  items: Array<{ title: string; quantity: number; unit_price: number; currency_id: 'BRL' }>
  external_reference: string
  notification_url: string
  back_urls: { success: string; pending: string; failure: string }
  marketplace_fee?: number
}

export async function mpCreatePreference(
  token: string,
  body: MpPreferenceCreate,
): Promise<{ id: string; init_point: string }> {
  const data = await mpFetch<{ id?: string; init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  if (!data.id || !data.init_point) throw new Error('MP preference sem id/init_point')
  return { id: data.id, init_point: data.init_point }
}

export interface MpPayment {
  id: number
  status?: string
  external_reference?: string
  transaction_amount?: number
}

export async function mpGetPayment(token: string, id: string): Promise<MpPayment> {
  return mpFetch<MpPayment>(`/v1/payments/${id}`, { headers: authHeaders(token) })
}
