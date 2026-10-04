// lib/checkin/receiptText.ts
// Interpreta o TEXTO que o OCR tirou do print do Wellhub. Puro.
//
// O OCR erra letra e símbolo (lido do print real: "Checlctin confirmado",
// "11h38 + 4 out" com o "•" virando "+", "ÊR Varandas Beach"), então as regras
// procuram padrões tolerantes em vez de frases exatas. O que dá a data e a hora
// é o cartão da academia ("11h38 • 4 out"), nunca o relógio da barra de status
// do celular ("11:38"), que só tem a hora e muda a cada print.
import type { ReceiptReading } from './receiptCheck'

const MONTHS: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
}

/**
 * "11h38 • 4 out" e variações do OCR: separador lido como "+", "·", "*", "-" ou
 * nenhum; "de" opcional antes do mês; "0" lido no lugar do "o" do mês.
 */
const CARD_DATE =
  /(\d{1,2})\s*h\s*(\d{2})\s*[•+·*.\-–]?\s*(\d{1,2})\s*(?:de\s+)?([a-z0]{3})\b/i

/** Marca da tela de check-in do Wellhub: o título ou o logo. */
function looksLikeWellhubCheckin(text: string): boolean {
  const t = text.toLowerCase()
  // "confirmado" sai inteiro mesmo quando "check-in" sai torto.
  return /confirmad/.test(t) || /wellhub/.test(t)
}

export function parseReceiptText(text: string): ReceiptReading {
  const flat = text.replace(/\s+/g, ' ')
  let day: number | null = null
  let month: number | null = null
  let hour: number | null = null
  let minute: number | null = null

  const m = CARD_DATE.exec(flat)
  if (m) {
    const monthKey = m[4].toLowerCase().replace(/0/g, 'o')
    if (MONTHS[monthKey]) {
      hour = Number(m[1])
      minute = Number(m[2])
      day = Number(m[3])
      month = MONTHS[monthKey]
    }
  }

  return {
    // Sem o cartão com data e hora não é a tela de check-in confirmado, mesmo
    // que a palavra "wellhub" apareça (a home do app também tem o logo).
    isWellhubCheckin: looksLikeWellhubCheckin(text) && month !== null,
    text,
    day,
    month,
    hour,
    minute,
  }
}

/** O OCR achou o cartão com data e hora? Decide se vale uma segunda passada. */
export function hasCardDate(text: string): boolean {
  return parseReceiptText(text).month !== null
}
