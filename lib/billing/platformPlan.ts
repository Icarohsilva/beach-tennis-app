// lib/billing/platformPlan.ts
// Plano único da plataforma (sem tiers). Preço fixo, 1º mês grátis (trial tratado em
// platform_subscriptions.trial_ends_at). Usado pela server action de assinatura e pela UI.
export const PLATFORM_PLAN = {
  priceMonthly: 49.9,
  currency: 'BRL',
  reason: 'ArenaHub — Assinatura Plataforma',
} as const
