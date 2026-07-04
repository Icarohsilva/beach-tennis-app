// lib/billing/periodicity.ts
// Regras de periodicidade dos planos (mensal→anual). Fonte única para meses,
// labels pt-BR, avanço de período e "assinatura em dia".
import type { Periodicity } from '@/types'

export const PERIODICITIES: readonly Periodicity[] = [
  'monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual',
]

export const PERIODICITY_MONTHS: Record<Periodicity, number> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: 'Mensal',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
}

// Soma meses clampando o dia ao último dia do mês destino (31/jan+1m → 28/fev).
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime())
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d
}

export function addPeriod(date: Date, periodicity: Periodicity): Date {
  return addMonthsClamped(date, PERIODICITY_MONTHS[periodicity])
}

// Assinatura "em dia": manual é gerida por fora (sempre em dia); mercadopago
// exige período pago vigente. Gate usado pela reconciliação de créditos e
// pela lista de inadimplentes.
export function isSubscriptionCurrent(
  sub: { gateway: string; current_period_end: string | null },
  now: Date = new Date(),
): boolean {
  if (sub.gateway !== 'mercadopago') return true
  if (!sub.current_period_end) return false
  return new Date(sub.current_period_end) >= now
}
