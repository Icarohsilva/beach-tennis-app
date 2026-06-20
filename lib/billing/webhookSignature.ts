// lib/billing/webhookSignature.ts
// Validação da assinatura secreta (x-signature) dos webhooks do MercadoPago.
//
// Spec oficial (https://www.mercadopago.com.br/developers/.../webhooks):
//   manifest = `id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;`
//   v1 = HMAC_SHA256(secret, manifest)  // hex
//   x-signature header = "ts=<ts>,v1=<v1>"
//   - O `data.id` vem da QUERY STRING da URL de notificação (não do corpo) e,
//     se for alfanumérico, entra em minúsculas.
//   - Segmentos cujo valor está ausente na notificação são OMITIDOS do manifest.
import crypto from 'crypto'

// Monta o manifest que o MercadoPago assinou, para podermos recalcular o HMAC.
export function buildSignatureManifest(params: {
  dataId: string | null | undefined
  requestId: string | null | undefined
  ts: string
}): string {
  const segments: string[] = []
  if (params.dataId) segments.push(`id:${params.dataId.toLowerCase()};`)
  if (params.requestId) segments.push(`request-id:${params.requestId};`)
  segments.push(`ts:${params.ts};`)
  return segments.join('')
}

// Extrai ts e v1 do header x-signature ("ts=...,v1=...").
export function parseSignatureHeader(xSignature: string | null | undefined): {
  ts: string | null
  v1: string | null
} {
  if (!xSignature) return { ts: null, v1: null }
  const parts: Record<string, string> = {}
  for (const pair of xSignature.split(',')) {
    const [k, v] = pair.split('=', 2)
    if (k && v !== undefined) parts[k.trim()] = v.trim()
  }
  return { ts: parts['ts'] ?? null, v1: parts['v1'] ?? null }
}

// Recalcula o HMAC e compara, em tempo constante, com o v1 enviado pelo MP.
export function isValidSignature(params: {
  xSignature: string | null | undefined
  requestId: string | null | undefined
  dataId: string | null | undefined
  secret: string
}): boolean {
  const { ts, v1 } = parseSignatureHeader(params.xSignature)
  if (!ts || !v1) return false

  const manifest = buildSignatureManifest({
    dataId: params.dataId,
    requestId: params.requestId,
    ts,
  })
  const expected = crypto.createHmac('sha256', params.secret).update(manifest).digest('hex')

  // timingSafeEqual exige buffers do mesmo tamanho; v1 malformado vira buffer de
  // tamanho diferente e cai no curto-circuito (sem lançar).
  const expectedBuf = Buffer.from(expected, 'hex')
  const v1Buf = Buffer.from(v1, 'hex')
  if (expectedBuf.length !== v1Buf.length) return false
  return crypto.timingSafeEqual(expectedBuf, v1Buf)
}
