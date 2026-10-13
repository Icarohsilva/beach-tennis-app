/**
 * Quantas vagas ainda disponíveis.
 * confirmedCount = COUNT(entry_status IN ('confirmed', 'offered'))
 * Retorna Infinity quando maxPlayers é null (sem limite).
 */
export function availableSlots(
  confirmedCount: number,
  maxPlayers: number | null,
): number {
  if (maxPlayers === null) return Infinity
  return Math.max(0, maxPlayers - confirmedCount)
}

/**
 * Retorna true se a oferta de vaga já venceu.
 */
export function isOfferExpired(offerExpiresAt: string | null): boolean {
  if (!offerExpiresAt) return false
  return new Date(offerExpiresAt) < new Date()
}

export interface OccupyingEntry {
  entry_status: 'confirmed' | 'waitlist' | 'offered'
  payment_status: 'free' | 'pending' | 'paid'
  partner_payment_status: 'free' | 'pending' | 'paid' | null
}

/**
 * A vaga ainda pode virar de outra pessoa? Sim enquanto alguém dela não pagou:
 * o admin pode cancelar por falta de pagamento e chamar quem está esperando.
 * Vaga oferecida também conta como em aberto, porque a pessoa não aceitou.
 * Grátis conta como resolvida: não há pagamento a esperar.
 */
export function isSlotUnsettled(e: OccupyingEntry): boolean {
  if (e.entry_status === 'offered') return true
  return e.payment_status === 'pending' || e.partner_payment_status === 'pending'
}

export type NewEntryStatus = 'confirmed' | 'waitlist' | 'full'

/**
 * Para onde vai uma inscrição nova.
 *
 * A lista de espera só existe quando as vagas estão TODAS ocupadas e ainda há
 * quem não pagou: é a fila de quem assume se alguém desistir de pagar. Com as
 * vagas preenchidas e pagas não há o que esperar, e a inscrição é recusada
 * ("esgotado") em vez de pôr a pessoa numa fila que nunca anda.
 */
export function newEntryStatus(input: {
  occupying: OccupyingEntry[]
  maxPlayers: number | null
}): NewEntryStatus {
  const occupied = input.occupying.filter((e) => e.entry_status !== 'waitlist')
  if (availableSlots(occupied.length, input.maxPlayers) > 0) return 'confirmed'
  return occupied.some(isSlotUnsettled) ? 'waitlist' : 'full'
}

/** Mensagem da inscrição recusada por `newEntryStatus === 'full'`. */
export const SOLD_OUT_MESSAGE =
  'As vagas deste torneio estão preenchidas e pagas, então não há lista de espera.'

/** Aviso ao lado do botão de inscrição quando ela vai cair na lista de espera. */
export const WAITLIST_SIGNUP_NOTICE =
  'As vagas estão preenchidas, mas ainda há inscrito sem pagar. Você entra na lista de espera, e a arena te chama pelo WhatsApp se abrir vaga.'
