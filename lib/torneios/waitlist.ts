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

/**
 * Monta URL do WhatsApp com mensagem pré-preenchida.
 * Remove caracteres não numéricos e adiciona DDI 55 se ausente.
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
}
