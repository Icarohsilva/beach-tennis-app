// lib/notifications/email.ts
// Envio de e-mail via Resend. I/O puro: recebe to/subject/html prontos.
// Fail-closed sem RESEND_API_KEY ou NOTIFICATIONS_FROM_EMAIL (log + no-op).
// Erro do Resend vira Error — quem decide o try/catch é o dispatch central.
import { Resend } from 'resend'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATIONS_FROM_EMAIL

  if (!apiKey || !from) {
    console.log('[email] RESEND_API_KEY ou NOTIFICATIONS_FROM_EMAIL ausente — envio ignorado', { to })
    return
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from, to, subject, html })
  if (error) {
    throw new Error(`[email] Resend retornou erro: ${error.message}`)
  }
}
