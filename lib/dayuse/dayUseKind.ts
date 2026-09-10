// lib/dayuse/dayUseKind.ts
// Tipo e preço do day use, puro. Existe porque três telas têm de dizer a MESMA
// coisa sobre o mesmo slot — a página pública, o card do aluno e o checkout do
// Mercado Pago — e o preço em particular não pode divergir entre o que a tela
// promete e o que a cobrança gera.
import type { DayUseKind } from '@/types'
import type { DayUsePaymentTiming } from './paymentMethod'

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
 * Centavos que este day use cobra. É `dayUsePriceCents` — **o preço é o preço**.
 *
 * Isto já foi condicionado a "a academia consegue cobrar dentro do app" (gateway
 * conectado ou chave PIX), e devolvia 0 quando não conseguia. O resultado é o
 * defeito que o uso real encontrou: o admin definia R$ 20 e TODA tela — inclusive
 * o link que o aluno abre — dizia "Gratuito". A cobrança na porta da arena, que é
 * como a maioria dos day use é paga, ficava invisível para o app.
 *
 * Agora o preço é sempre o preço, e o que varia é **como se cobra**:
 * `resolveDayUsePaymentMethod` escolhe entre carteira, Checkout Pro, PIX na chave
 * da arena e `on_site` (pagar na arena). Gratuito passou a significar só uma
 * coisa: preço zero.
 */
export function dayUseChargeCents(
  slot: { price_cents?: number | null },
  opts: { defaultCents: number },
): number {
  return dayUsePriceCents(slot, opts.defaultCents)
}

/**
 * O preço e ONDE ele é pago.
 *
 * Uma leitura só de preço (`priceCents`), porque preço na tela e preço cobrado
 * não podem divergir — foi essa divergência que fez o app anunciar "Gratuito"
 * um day use de R$ 20. O que muda é ONDE se paga, e isso agora é **escolha da
 * academia** (`payment_timing`), não dedução da configuração dela: arena com
 * PIX cadastrado que cobra na porta marca `on_site`, e quem quer receber antes
 * marca `on_booking`.
 *
 * A configuração ainda entra como TETO: marcado para pagar na inscrição sem
 * gateway nem chave PIX, não há como receber online, e o efetivo cai para
 * `on_site` com `needsSetup` ligado — a tela do admin avisa em vez de a reserva
 * quebrar na frente do aluno.
 */
export interface DayUsePriceView {
  priceCents: number
  /** O que vale de fato, depois do teto da configuração. */
  timing: DayUsePaymentTiming
  /** Dá para pagar dentro do app (Checkout Pro ou PIX na chave da arena)? */
  collectedInApp: boolean
  /** Tem preço e o pagamento acontece na arena. */
  payOnSite: boolean
  /** Pedia pagamento na inscrição, mas a academia não tem como receber online. */
  needsSetup: boolean
}

export function dayUsePriceView(
  slot: { price_cents?: number | null; payment_timing?: DayUsePaymentTiming | null },
  opts: { defaultCents: number; canCharge: boolean },
): DayUsePriceView {
  const priceCents = dayUsePriceCents(slot, opts.defaultCents)
  const wanted: DayUsePaymentTiming = slot.payment_timing ?? 'on_site'
  const timing: DayUsePaymentTiming =
    wanted === 'on_booking' && opts.canCharge ? 'on_booking' : 'on_site'
  return {
    priceCents,
    timing,
    collectedInApp: priceCents > 0 && timing === 'on_booking',
    payOnSite: priceCents > 0 && timing === 'on_site',
    needsSetup: priceCents > 0 && wanted === 'on_booking' && !opts.canCharge,
  }
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
