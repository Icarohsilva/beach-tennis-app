// lib/notifications/push.ts
// Envio de Web Push via web-push. I/O puro: recebe uma inscrição + mensagem.
// Fail-closed sem chaves VAPID (log + no-op). Erros 404/410 viram 'expired'
// para o dispatch podar a inscrição; outros erros relançam (o dispatch isola).
import webpush from 'web-push'

export interface PushSubscriptionData {
  endpoint: string
  p256dh: string
  auth: string
}

export interface SendPushParams {
  subscription: PushSubscriptionData
  title: string
  body: string
  url?: string
}

export type SendPushResult = 'ok' | 'expired' | 'skipped'

let configured = false

function ensureConfigured(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return false
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configured = true
  }
  return true
}

export async function sendPush({ subscription, title, body, url }: SendPushParams): Promise<SendPushResult> {
  if (!ensureConfigured()) {
    console.log('[push] chaves VAPID ausentes — envio ignorado', {
      endpoint: subscription.endpoint.slice(0, 40),
    })
    return 'skipped'
  }

  const payload = JSON.stringify({ title, body, url: url ?? '/home' })

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
    )
    return 'ok'
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) return 'expired'
    throw err
  }
}
