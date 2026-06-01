// lib/utils/creditRules.ts

export const CANCELLATION_WINDOW_HOURS = 5

/**
 * Returns true if cancellation is more than CANCELLATION_WINDOW_HOURS before session.
 * Only then does the student receive a makeup credit.
 */
export function canCancelWithRefund(
  sessionStartIso: string,
  nowIso: string,
  windowHours = CANCELLATION_WINDOW_HOURS,
): boolean {
  const sessionStart = new Date(sessionStartIso)
  const now = new Date(nowIso)
  const diffHours = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60)
  return diffHours > windowHours
}

/**
 * Returns the expiry date for a makeup credit.
 * Default: 30 days. Configurable via system_settings.credit_expiry_days.
 */
export function getMakeupCreditExpiry(from: Date, expiryDays: number): Date {
  const expiry = new Date(from)
  expiry.setDate(expiry.getDate() + expiryDays)
  return expiry
}

/** Returns true if a makeup credit has expired */
export function isCreditExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return false // monthly credits: handled by month-end cron
  return new Date(expiresAt) < now
}
