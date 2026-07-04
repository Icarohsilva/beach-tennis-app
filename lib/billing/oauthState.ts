// lib/billing/oauthState.ts
// `state` assinado do fluxo OAuth do Mercado Pago (anti-CSRF). Carrega orgId +
// userId com expiração de 10 min; HMAC-SHA256 com MP_APP_SECRET.
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

interface OAuthStatePayload {
  orgId: string
  userId: string
  exp: number
}

export function createOAuthState(
  input: { orgId: string; userId: string },
  secret: string,
  now: number = Date.now(),
): string {
  const payload: OAuthStatePayload = { ...input, exp: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): { orgId: string; userId: string } | null {
  if (!state) return null
  const [body, sig] = state.split('.')
  if (!body || !sig) return null

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload
    if (typeof payload.exp !== 'number' || payload.exp < now) return null
    if (!payload.orgId || !payload.userId) return null
    return { orgId: payload.orgId, userId: payload.userId }
  } catch {
    return null
  }
}
