// lib/dayuse/dayUseKind.ts
// Tipo e preço do day use, puro. Existe porque três telas têm de dizer a MESMA
// coisa sobre o mesmo slot — a página pública, o card do aluno e o checkout do
// Mercado Pago — e o preço em particular não pode divergir entre o que a tela
// promete e o que a cobrança gera.
import type { DayUseKind } from '@/types'

export const DAY_USE_KINDS: readonly DayUseKind[] = ['scheduled', 'open']

export const DAY_USE_KIND_LABEL: Record<DayUseKind, string> = {
  scheduled: 'Horário marcado',
  open: 'Livre no período',
}

/**
 * O que o tipo promete a quem vai reservar.
 *
 * Frase e não só rótulo: "livre no período" não se explica sozinho, e a
 * diferença entre reservar UM horário e entrar num período com rotação de
 * quadra é justamente o que o aluno precisa saber antes de pagar.
 */
export function dayUseKindHint(kind: DayUseKind): string {
  return kind === 'open'
    ? 'Entre e jogue a qualquer momento do período, com rotação de quadra.'
    : 'Você reserva este horário e a vaga é sua.'
}

/**
 * Preço a cobrar por este day use, em centavos.
 *
 * Precedência slot → academia num lugar só. `price_cents` nulo é "não
 * configurei este day use", e cai no padrão da arena — que é como todas as
 * academias operam hoje, antes de existir preço por slot. Devolve 0 quando não
 * há preço em lugar nenhum, e 0 significa GRATUITO (o caminho livre de
 * `bookDayUse`), não "erro".
 */
export function dayUsePriceCents(
  slot: { price_cents?: number | null },
  orgDefaultCents: number,
): number {
  const own = slot.price_cents
  if (own !== null && own !== undefined) return own
  return Math.max(0, Math.round(orgDefaultCents))
}

/**
 * Centavos que este day use realmente cobra.
 *
 * `canCharge` é "a academia consegue cobrar" — venda ligada E gateway conectado.
 * Sem isso a tela mostrava R$ 40 e a reserva saía gratuita (o caminho sem token
 * de `bookDayUse` grava `confirmed` na hora), então preço na tela e cobrança de
 * verdade divergiam justamente para a academia mal configurada.
 */
export function dayUseChargeCents(
  slot: { price_cents?: number | null },
  opts: { defaultCents: number; canCharge: boolean },
): number {
  if (!opts.canCharge) return 0
  return dayUsePriceCents(slot, opts.defaultCents)
}

/** Reais (system_settings.day_use_price é string de reais) para centavos. */
export function reaisToCents(reais: string | number | null | undefined): number {
  const n = typeof reais === 'string' ? parseFloat(reais.replace(',', '.')) : (reais ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 100)
}

/**
 * Título da cobrança no checkout.
 *
 * O extrato do aluno e o painel do Mercado Pago mostravam só "Day Use" para
 * tudo — sem modalidade nem data não havia como casar a linha com o que foi
 * comprado, nem em caso de contestação.
 */
export function dayUseChargeTitle(input: {
  sportLabel?: string | null
  date: string
}): string {
  const [y, m, d] = input.date.split('-')
  const dia = y && m && d ? `${d}/${m}` : input.date
  return input.sportLabel ? `Day Use ${input.sportLabel} · ${dia}` : `Day Use · ${dia}`
}

/**
 * Preço para a tela: `R$ 40,00`, ou "Gratuito" quando não há preço.
 *
 * Um lugar só porque a página pública, o card do aluno e o card do admin
 * mostravam o mesmo número escrito de três jeitos — e "Gratuito" tem de sair
 * do MESMO cálculo que decide não abrir checkout, senão a tela promete grátis
 * e o app cobra.
 */
export function formatDayUsePrice(cents: number): string {
  if (cents <= 0) return 'Gratuito'
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}
