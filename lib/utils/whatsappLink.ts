// lib/utils/whatsappLink.ts
// Link wa.me com mensagem pré-preenchida. Vivia em lib/torneios/waitlist.ts;
// mudou de casa quando o Controle Wellhub passou a precisar do mesmo link para
// cobrar pendências de check-in.

/**
 * Monta URL do WhatsApp com mensagem pré-preenchida.
 * Remove caracteres não numéricos e adiciona DDI 55 se ausente
 * (mesma normalização de lib/notifications/whatsapp.ts → normalizePhone).
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`
}

/**
 * Link de compartilhamento SEM destinatário: o WhatsApp abre a lista de
 * contatos/grupos para a pessoa escolher.
 *
 * Existe separado de `buildWhatsAppUrl` porque lá o telefone é obrigatório
 * (cobrança de pendência, convite de dupla) e aqui não há a quem endereçar —
 * quem divulga o day use é a arena, no próprio grupo dela.
 */
export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
