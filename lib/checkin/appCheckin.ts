// lib/checkin/appCheckin.ts
// Check-in Wellhub feito pelo aluno no app, com o print como comprovante. Puro.
//
// Existe para a arena SEM a integração do Wellhub: lá o check-in do aluno nunca
// chegava ao sistema. Três condições, e as três têm motivo:
//  - a arena ligou a chave — cada arena decide se aceita o print como prova;
//  - a integração NÃO está conectada — conectada, o check-in já chega sozinho
//    pelo webhook, e um segundo caminho duplicaria o mesmo dia;
//  - o aluno é do plano Wellhub — quem não é segue o fluxo de sempre.
import type { CheckinPartner } from '@/types'

/** Chave em system_settings ('true' | 'false'). */
export const APP_CHECKIN_SETTING = 'wellhub_app_checkin_enabled'

/** O único parceiro atendido por enquanto. */
export const APP_CHECKIN_PARTNER: CheckinPartner = 'wellhub'

export type AppCheckinBlock =
  /** A arena não ligou o check-in pelo app. */
  | 'disabled'
  /** A integração com o Wellhub está conectada: o check-in já é automático. */
  | 'integration'
  /** O aluno não é do plano Wellhub nesta arena. */
  | 'not_partner'

export function resolveAppCheckin(input: {
  enabled: boolean
  integrationConnected: boolean
  partner: CheckinPartner | null | undefined
}): { available: true } | { available: false; reason: AppCheckinBlock } {
  if (!input.enabled) return { available: false, reason: 'disabled' }
  if (input.integrationConnected) return { available: false, reason: 'integration' }
  if (input.partner !== APP_CHECKIN_PARTNER) return { available: false, reason: 'not_partner' }
  return { available: true }
}

/**
 * Identificador do check-in do DIA. Entra em `checkins.external_ref`, e o índice
 * único (organization_id, partner, external_ref) é o que garante um check-in por
 * dia mesmo com dois toques seguidos no botão.
 */
export function appCheckinRef(studentId: string, date: string): string {
  return `app:${studentId}:${date}`
}

export const RECEIPT_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

/** Confere o print antes de subir. null = ok. */
export function validateReceiptFile(file: { type: string; size: number } | null): string | null {
  if (!file || file.size === 0) return 'Anexe o print do check-in no app do Wellhub.'
  if (!RECEIPT_MIME_EXT[file.type]) return 'Formato não suportado. Envie uma imagem JPG, PNG ou WEBP.'
  if (file.size > MAX_RECEIPT_BYTES) return 'Imagem muito grande (máx. 5 MB).'
  return null
}

/** Caminho do print no bucket checkin-receipts: academia/aluno/dia. */
export function receiptPath(orgId: string, studentId: string, date: string, mime: string): string {
  return `${orgId}/${studentId}/${date}.${RECEIPT_MIME_EXT[mime] ?? 'jpg'}`
}
