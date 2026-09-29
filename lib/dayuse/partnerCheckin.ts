// lib/dayuse/partnerCheckin.ts
// Day use pago com check-in de Wellhub (ex-Gympass) ou TotalPass. Puro, sem I/O.
//
// Quem é parceiro não paga a arena: paga o app do parceiro, e a arena recebe
// dele pelo check-in validado. O que faltava era o CONTROLE — a arena pedia no
// grupo "quem for de Gympass, avisa os meninos do quiosque", porque nada no app
// dizia quem vinha por parceiro. Agora a pessoa escolhe isso ao reservar, e a
// lista do day use mostra ao quiosque quem precisa validar o check-in.
//
// A arena LIGA cada parceiro (system_settings.day_use_partners). Sem isso, toda
// arena passaria a oferecer "usar Wellhub" num day use pago, e quem não aceita
// parceiro veria gente reservando sem pagar.

export type DayUsePartner = 'wellhub' | 'totalpass'

export const DAY_USE_PARTNERS: readonly DayUsePartner[] = ['wellhub', 'totalpass']

export const PARTNER_LABEL: Record<DayUsePartner, string> = {
  wellhub: 'Wellhub (Gympass)',
  totalpass: 'TotalPass',
}

/** Nome curto, para botão e chip. */
export const PARTNER_SHORT_LABEL: Record<DayUsePartner, string> = {
  wellhub: 'Wellhub',
  totalpass: 'TotalPass',
}

export function isDayUsePartner(value: unknown): value is DayUsePartner {
  return value === 'wellhub' || value === 'totalpass'
}

/** "wellhub,totalpass" (como mora em system_settings) → lista válida, sem repetição. */
export function parseAcceptedPartners(raw: string | null | undefined): DayUsePartner[] {
  const wanted = new Set((raw ?? '').split(',').map((s) => s.trim().toLowerCase()))
  return DAY_USE_PARTNERS.filter((p) => wanted.has(p))
}

export function serializeAcceptedPartners(partners: readonly string[]): string {
  return DAY_USE_PARTNERS.filter((p) => partners.includes(p)).join(',')
}

/**
 * Parceiros que ESTE day use oferece. Vazio quando é gratuito: sem preço não há
 * o que o parceiro pagar, e perguntar "vai usar Wellhub?" num day use de graça
 * só confunde quem vai reservar.
 */
export function partnerOptionsFor(input: {
  priceCents: number
  accepted: readonly DayUsePartner[]
}): DayUsePartner[] {
  return input.priceCents > 0 ? [...input.accepted] : []
}

/** O que o aluno lê depois de reservar pelo parceiro. */
export function partnerBookedNotice(partner: DayUsePartner): string {
  return `Faça o check-in no app ${PARTNER_SHORT_LABEL[partner]} quando chegar e avise no quiosque.`
}

/**
 * O aviso ANTES de reservar pelo parceiro. Diz a regra que sustenta o desenho:
 * o check-in precisa passar no quiosque, e se não passar a entrada é cobrada
 * na arena — sem isso a pessoa reserva achando que o parceiro garante a vaga.
 */
export function partnerBookingWarning(partner: DayUsePartner, priceLabel: string): string {
  const nome = PARTNER_SHORT_LABEL[partner]
  return (
    `Você não paga nada pelo app. Ao chegar, faça o check-in no app ${nome} e avise no quiosque.\n`
    + `Se o check-in não for aceito, a entrada (${priceLabel}) é paga na arena.`
  )
}
