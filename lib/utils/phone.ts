// lib/utils/phone.ts
// WhatsApp informado no cadastro. Puro, sem I/O.
//
// É obrigatório nos cadastros feitos pela própria pessoa: sem ele a arena não
// tem por onde mandar a senha, a cobrança da inscrição ou o aviso de mudança de
// horário — e quem se cadastra pelo link do torneio não abre o app todo dia.

export type WhatsAppParse =
  | { ok: true; digits: string; formatted: string }
  | { ok: false; error: string }

const REQUIRED = 'Informe seu WhatsApp com DDD. É por ele que a arena fala com você.'
const INVALID = 'WhatsApp inválido. Use DDD + número, ex: (31) 99999-9999.'

/**
 * Número nacional (DDD + telefone) a partir do que a pessoa digitou.
 *
 * Aceita máscara, espaços e o +55 na frente. Fixo (10 dígitos) passa porque
 * WhatsApp Business roda em número fixo; o que não passa é número sem DDD, que
 * é o erro mais comum e o que deixa a mensagem sem destino.
 */
export function parseWhatsApp(raw: string): WhatsAppParse {
  let digits = raw.replace(/\D/g, '')
  if (!digits) return { ok: false, error: REQUIRED }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2)
  }
  if (digits.length !== 10 && digits.length !== 11) return { ok: false, error: INVALID }
  // DDD começa em 1..9 (não existe DDD 0x) e o celular de 11 dígitos começa em 9.
  if (digits[0] === '0' || digits[1] === '0') return { ok: false, error: INVALID }
  if (digits.length === 11 && digits[2] !== '9') return { ok: false, error: INVALID }
  return { ok: true, digits, formatted: formatWhatsApp(digits) }
}

/** Máscara enquanto digita: "31999999999" → "(31) 99999-9999". */
export function formatWhatsApp(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2)
  d = d.slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const split = rest.length === 9 ? 5 : 4
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
}
