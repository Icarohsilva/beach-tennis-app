// lib/pwa/pushClient.ts
// Helpers de client: registra o SW, inscreve/desinscreve no push e sincroniza
// com o servidor via server actions.
import { savePushSubscription, deletePushSubscription } from '@/features/notifications/pushActions'
import { urlBase64ToUint8Array } from './pushEncoding'

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js')
}

export async function subscribeToPush(): Promise<{ error?: string }> {
  if (!isPushSupported()) {
    return { error: 'Notificações não são suportadas neste dispositivo.' }
  }
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) return { error: 'Notificações indisponíveis no momento.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { error: 'Permissão de notificação negada.' }

  const reg = await registerServiceWorker()
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // cast: urlBase64ToUint8Array retorna Uint8Array<ArrayBufferLike>; o lib.dom
      // atual tipa applicationServerKey como BufferSource (ArrayBuffer específico).
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    }))

  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { error: 'Inscrição de notificações inválida.' }
  }

  return savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  })
}

export async function unsubscribeFromPush(): Promise<{ error?: string }> {
  if (!isPushSupported()) return {}
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return {}
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  return deletePushSubscription(endpoint)
}
