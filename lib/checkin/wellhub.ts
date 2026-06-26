// lib/checkin/wellhub.ts
// Peça ISOLADA da integração Wellhub: formato do payload + verificação de assinatura.
//
// ASSUNÇÃO (até a doc autenticada do Access Control API ser confirmada com as
// credenciais do Hudson): o evento de check-in chega como JSON no formato abaixo,
// e a assinatura é o HMAC-SHA256 (hex) do corpo cru com o webhook_secret da academia.
//   {
//     "id": "evt_abc123",                         // referência única do evento
//     "event": "checkin.created",
//     "data": {
//       "gym":     { "id": "gym_789" },           // unidade → roteia p/ academia
//       "member":  { "id": "GP123456" },          // ID Wellhub do aluno
//       "checkin": { "at": "2026-06-25T13:45:00Z" }
//     }
//   }
// Quando a doc real chegar, SÓ este arquivo muda — o núcleo de ingestão não.
import crypto from 'crypto'

export interface CanonicalCheckinEvent {
  gymId: string
  partnerMemberId: string
  checkinDate: string // yyyy-MM-dd
  externalRef: string | null
}

interface RawWellhubEvent {
  id?: string
  data?: {
    gym?: { id?: string }
    member?: { id?: string }
    checkin?: { at?: string }
  }
}

// Normaliza o payload cru da Wellhub. Lança erro se malformado/incompleto.
export function parseWellhubEvent(rawBody: string): CanonicalCheckinEvent {
  const raw = JSON.parse(rawBody) as RawWellhubEvent
  const gymId = raw.data?.gym?.id
  const partnerMemberId = raw.data?.member?.id
  const at = raw.data?.checkin?.at
  if (!gymId || !partnerMemberId || !at) {
    throw new Error('Wellhub event malformado: campos obrigatórios ausentes')
  }
  return {
    gymId,
    partnerMemberId,
    checkinDate: at.slice(0, 10),
    externalRef: raw.id ?? null,
  }
}

// Verifica a assinatura do corpo cru com o segredo da academia, em tempo constante.
export function verifyWellhubSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const sigBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== sigBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, sigBuf)
}
