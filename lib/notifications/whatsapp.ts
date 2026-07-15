// lib/notifications/whatsapp.ts
// Envio de WhatsApp via Z-API. I/O puro: recebe telefone + mensagem prontos.
// Fail-closed sem credenciais (log + no-op). Erro HTTP vira Error — quem decide
// o try/catch é o dispatch central.
const ZAPI_BASE = 'https://api.z-api.io'

export interface SendWhatsAppParams {
  phone: string
  message: string
}

/** Remove nao-digitos e garante DDI 55 (mesma regra de buildWhatsAppUrl). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}

export async function sendWhatsApp({ phone, message }: SendWhatsAppParams): Promise<void> {
  const instanceId = process.env.ZAPI_INSTANCE_ID
  const token = process.env.ZAPI_TOKEN
  const clientToken = process.env.ZAPI_CLIENT_TOKEN

  if (!instanceId || !token || !clientToken) {
    console.log('[whatsapp] credenciais Z-API ausentes — envio ignorado', { phone })
    return
  }

  const url = `${ZAPI_BASE}/instances/${instanceId}/token/${token}/send-text`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': clientToken,
    },
    body: JSON.stringify({ phone: normalizePhone(phone), message }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[whatsapp] Z-API ${res.status}: ${body.slice(0, 300)}`)
  }
}
