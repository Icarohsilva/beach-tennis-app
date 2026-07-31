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
