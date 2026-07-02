// lib/checkin/wellhub.ts
// Peça ISOLADA da integração Wellhub (Gympass): formato do payload + verificação
// de assinatura. Contrato confirmado na doc de sandbox do Access Control API.
//
// Evento de check-in (Gympass envia via webhook quando o usuário faz check-in no app):
//   {
//     "event_type": "checkin",
//     "event_data": {
//       "user":  { "unique_token": "0123456789012", ... },  // gympass_id do aluno (13 díg.)
//       "gym":   { "id": 123456, ... },                       // unidade → roteia p/ academia
//       "timestamp": 1666629613                               // Unix epoch (ver epochToLocalDate)
//     }
//   }
// O evento de check-in NÃO traz event_id; sintetizamos uma chave de dedupe estável
// (gym:user:timestamp) para idempotência. A assinatura vem no header X-Gympass-Signature.
import crypto from 'crypto'

// Timezone das academias (app pt-BR). O timestamp do evento é epoch UTC; a data do
// check-in precisa ser a data LOCAL para casar com as sessões (ex.: check-in 22h BRT
// não pode virar o dia seguinte em UTC).
const GYM_TIMEZONE = 'America/Sao_Paulo'

export interface CanonicalCheckinEvent {
  kind: 'checkin'
  gymId: string
  partnerMemberId: string
  checkinDate: string // yyyy-MM-dd (data local da academia)
  externalRef: string // chave de dedupe sintetizada (gym:user:timestamp)
}

// Evento reconhecido mas fora do escopo desta rota (ex.: booking.*): ignorar com 200.
export interface IgnoredEvent {
  kind: 'ignored'
}

interface RawWellhubEvent {
  event_type?: string
  event_data?: {
    user?: { unique_token?: string }
    gym?: { id?: number | string }
    timestamp?: number
  }
}

function epochToLocalDate(timestamp: number): string {
  // A doc da Wellhub é ambígua na unidade: o POST de exemplo usa SEGUNDOS (10 díg.,
  // ex. 1666629613) e o "response example" usa MILISSEGUNDOS (13 díg.). Detecta pela
  // magnitude p/ não errar a data (>= 1e12 ⇒ já está em ms).
  const ms = timestamp >= 1e12 ? timestamp : timestamp * 1000
  // en-CA formata como yyyy-MM-dd; timeZone converte para a data local da academia.
  return new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TIMEZONE }).format(new Date(ms))
}

// Normaliza o payload cru da Wellhub. Eventos não-checkin → { kind: 'ignored' }.
// Lança erro só quando o JSON é inválido ou um evento de check-in está incompleto.
export function parseWellhubEvent(rawBody: string): CanonicalCheckinEvent | IgnoredEvent {
  const raw = JSON.parse(rawBody) as RawWellhubEvent

  // Aceita qualquer variação de check-in. Produção envia "checkin"; o simulador do
  // sandbox emite "checkin-booking-occurred". Demais eventos (ex.: "booking-*") → ignora.
  if (!raw.event_type?.startsWith('checkin')) {
    return { kind: 'ignored' }
  }

  const gymId = raw.event_data?.gym?.id
  const partnerMemberId = raw.event_data?.user?.unique_token
  const timestamp = raw.event_data?.timestamp
  if (gymId == null || !partnerMemberId || typeof timestamp !== 'number') {
    throw new Error('Wellhub checkin malformado: campos obrigatórios ausentes')
  }

  const gymIdStr = String(gymId)
  return {
    kind: 'checkin',
    gymId: gymIdStr,
    partnerMemberId,
    checkinDate: epochToLocalDate(timestamp),
    externalRef: `${gymIdStr}:${partnerMemberId}:${timestamp}`,
  }
}

// Verifica a assinatura do corpo cru com o segredo da academia, em tempo constante.
// Contrato confirmado na doc do Access Control API: HMAC-SHA1 do corpo cru, em hex
// MAIÚSCULO no header X-Gympass-Signature. O exemplo da doc traz um prefixo "0X"
// (ex.: 0XFBDB…) que os próprios scripts de geração não emitem — então normalizamos
// removendo o prefixo opcional e comparando em bytes (case-insensitive por natureza do hex).
export function verifyWellhubSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false
  const normalized = signature.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return false

  const expected = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const sigBuf = Buffer.from(normalized, 'hex')
  if (expectedBuf.length !== sigBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, sigBuf)
}
