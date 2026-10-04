// lib/checkin/receiptCheck.ts
// Regras do print de check-in do Wellhub, depois de lido (receiptReader.ts). Puro.
//
// O objetivo é tirar do admin o "conferir print por print": o que passa aqui
// entra como validado, o que é claramente inválido é recusado na hora, e só o
// caso duvidoso (nome da academia diferente) fica para ele olhar.
//
// A régua principal é a do pedido da arena: o print tem de ser de HOJE e não
// pode ser anterior ao último comprovante do aluno — é o que barra o print
// antigo reaproveitado e o mesmo check-in mandado duas vezes.

export interface ReceiptReading {
  /** É a tela "Check-in confirmado" do app do Wellhub. */
  isWellhubCheckin: boolean
  /** Texto lido do print, onde se procura o nome da academia. */
  text: string
  day: number | null
  /** 1..12 */
  month: number | null
  hour: number | null
  minute: number | null
}

export type ReceiptVerdict =
  | { status: 'validated' | 'review'; takenAt: string; note: string | null }
  | { status: 'rejected'; reason: string }

/** Folga para relógio de celular adiantado: além disso, "hora no futuro" é edição. */
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** yyyy-MM-dd de hoje em Brasília. */
function brtDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/**
 * Palavras que quase toda arena tem no nome: casar por elas diria que "Hudson
 * Beach Tennis" e "Varandas Beach" são a mesma academia.
 */
const GENERIC_WORDS = new Set([
  'arena', 'beach', 'tennis', 'tenis', 'futevolei', 'volei', 'padel', 'sports', 'sport',
  'esporte', 'esportes', 'clube', 'club', 'centro', 'academia', 'quadra', 'quadras',
])

function normalize(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))
}

/**
 * O nome no print bate com o da arena? Basta uma palavra significativa em comum
 * ("Varandas Beach" e "Arena Varandas Beach Futevôlei"): o Wellhub cadastra a
 * academia com o nome dele, raramente idêntico ao do app.
 */
export function gymNameMatches(orgName: string, gymText: string | null): boolean {
  if (!gymText) return false
  const org = new Set(normalize(orgName))
  return normalize(gymText).some((w) => org.has(w))
}

export function checkReceipt(input: {
  reading: ReceiptReading
  now: Date
  orgName: string
  /** receipt_taken_at do último comprovante deste aluno nesta arena. */
  lastTakenAt: string | null
}): ReceiptVerdict {
  const { reading, now } = input

  if (!reading.isWellhubCheckin) {
    return {
      status: 'rejected',
      reason: 'Este print não é a tela de "Check-in confirmado" do Wellhub. Envie o print dessa tela.',
    }
  }

  const { day, month, hour, minute } = reading
  if (day == null || month == null || hour == null || minute == null) {
    return {
      status: 'rejected',
      reason: 'Não deu para ler a data e a hora do check-in. Envie o print da tela inteira, sem cortes.',
    }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { status: 'rejected', reason: 'A data ou a hora do print não é válida.' }
  }

  const today = brtDate(now)
  const year = Number(today.slice(0, 4))
  const date = `${year}-${pad(month)}-${pad(day)}`
  if (date !== today) {
    return {
      status: 'rejected',
      reason: `Este print é de um check-in de ${pad(day)}/${pad(month)}. Envie o print do check-in de hoje.`,
    }
  }

  const takenAt = new Date(`${date}T${pad(hour)}:${pad(minute)}:00-03:00`)
  if (takenAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { status: 'rejected', reason: 'A hora do print está no futuro. Envie o print original do Wellhub.' }
  }

  if (input.lastTakenAt && takenAt.getTime() <= new Date(input.lastTakenAt).getTime()) {
    return {
      status: 'rejected',
      reason: 'Este print é igual ou anterior ao último comprovante enviado. Envie o print do check-in de agora.',
    }
  }

  // O nome é procurado no texto inteiro do print: o OCR suja o começo da linha
  // ("ÊR Varandas Beach"), mas as palavras do nome saem inteiras.
  if (!gymNameMatches(input.orgName, reading.text)) {
    return {
      status: 'review',
      takenAt: takenAt.toISOString(),
      note: 'O nome da arena não aparece no print. Confira se o check-in foi aqui.',
    }
  }

  return { status: 'validated', takenAt: takenAt.toISOString(), note: null }
}
