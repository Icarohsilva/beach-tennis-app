// lib/billing/platformAccess.ts
// Função PURA (sem I/O, sem imports de servidor) — coração do enforcement de cobrança.
// Regra: admin liberado se (active E pago em dia) OU (trialing E trial em dia).
export type PlatformStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

export interface PlatformSubscriptionState {
  status: PlatformStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

export interface PlatformAccess {
  allowed: boolean
  daysLeft: number // dias até o fim do período relevante; 0 se vencido/sem data
}

const DAY_MS = 86400000

function daysUntil(iso: string | null, now: Date): number {
  if (!iso) return 0
  const diff = new Date(iso).getTime() - now.getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_MS)
}

export function computePlatformAccess(
  state: PlatformSubscriptionState,
  now: Date,
): PlatformAccess {
  if (state.status === 'active' && state.currentPeriodEnd) {
    const left = daysUntil(state.currentPeriodEnd, now)
    if (left > 0) return { allowed: true, daysLeft: left }
  }
  if (state.status === 'trialing' && state.trialEndsAt) {
    const left = daysUntil(state.trialEndsAt, now)
    if (left > 0) return { allowed: true, daysLeft: left }
  }
  return { allowed: false, daysLeft: 0 }
}
