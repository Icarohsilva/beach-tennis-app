// lib/notifications/dispatch.ts
// Helper central de disparo multi-canal. In-app é o canal garantido (nosso
// banco — falha aqui é erro real e PROPAGA). E-mail/WhatsApp são best-effort:
// cada envio roda isolado em try/catch e reporta ao Sentry, nunca derruba a
// acao de origem (broadcast ou gatilho transacional).
import * as Sentry from '@sentry/nextjs'
import type { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from './email'
import { sendWhatsApp } from './whatsapp'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Valores convencionais: 'admin_message' | 'waitlist_offer' | 'class_cancelled'
 * | 'low_credits' | 'payment_past_due'. Aceita string livre porque o broadcast
 * do admin ja usa tipos proprios ('announcement', etc.) como notifications.type.
 */
export type NotificationType = string

export type NotificationChannel = 'inapp' | 'email' | 'whatsapp'

export interface NotifyRecipient {
  userId: string
  email?: string | null
  phone?: string | null
}

export interface NotifyUsersParams {
  orgId: string
  recipients: NotifyRecipient[]
  type: NotificationType
  title: string
  body: string
  channels: NotificationChannel[]
}

function buildEmailHtml(title: string, body: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #f97316;">${title}</h2>
      <p style="color: #1f2937; white-space: pre-line;">${body}</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">Esta é uma mensagem automática da sua academia.</p>
    </div>
  `.trim()
}

function buildWhatsAppText(title: string, body: string): string {
  return `*${title}*\n\n${body}`
}

/**
 * Dispara uma notificacao para varios destinatarios nos canais pedidos.
 * In-app falha alto (erro do nosso banco). E-mail/WhatsApp nunca lançam — cada
 * falha é reportada ao Sentry com tags { channel, notificationType }.
 */
export async function notifyUsers(
  client: AdminClient,
  { orgId, recipients, type, title, body, channels }: NotifyUsersParams,
): Promise<void> {
  if (recipients.length === 0) return

  if (channels.includes('inapp')) {
    const rows = recipients.map((r) => ({
      organization_id: orgId,
      user_id: r.userId,
      type,
      title,
      body,
      read: false,
    }))
    const { error } = await client.from('notifications').insert(rows)
    if (error) {
      throw new Error(`[notifyUsers] insert em notifications falhou: ${error.message}`)
    }
  }

  if (channels.includes('email')) {
    const html = buildEmailHtml(title, body)
    for (const r of recipients) {
      if (!r.email) continue
      try {
        await sendEmail({ to: r.email, subject: title, html })
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'email', notificationType: type },
          extra: { orgId, userId: r.userId },
        })
      }
    }
  }

  if (channels.includes('whatsapp')) {
    const message = buildWhatsAppText(title, body)
    for (const r of recipients) {
      if (!r.phone) continue
      try {
        await sendWhatsApp({ phone: r.phone, message })
      } catch (err) {
        Sentry.captureException(err, {
          tags: { channel: 'whatsapp', notificationType: type },
          extra: { orgId, userId: r.userId },
        })
      }
    }
  }
}
