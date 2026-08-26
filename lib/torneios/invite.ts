// lib/torneios/invite.ts
// Estado de um convite de parceiro (tournament_partner_invites, migração
// 20260826000700) — puro, sobre a linha já lida do banco.
export type InviteState = 'pending' | 'accepted' | 'declined' | 'expired'

export interface InviteRow {
  expires_at: string
  accepted_at: string | null
  declined_at: string | null
}

/**
 * Precedência: aceito e recusado são fatos definitivos e vêm antes de
 * expiração — um convite aceito 1 minuto antes do prazo continua aceito.
 */
export function inviteState(row: InviteRow, now: Date): InviteState {
  if (row.accepted_at !== null) return 'accepted'
  if (row.declined_at !== null) return 'declined'
  if (new Date(row.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

const INVITE_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * 48h a partir de agora — o mesmo prazo da oferta de vaga da fila de espera
 * (features/torneios/actions.ts) — mas nunca além do prazo de inscrição do
 * torneio: um convite aceitável depois que a inscrição fechou não faz sentido.
 */
export function inviteExpiry(now: Date, registrationDeadline: string | null): string {
  const defaultExpiry = now.getTime() + INVITE_WINDOW_MS
  if (!registrationDeadline) return new Date(defaultExpiry).toISOString()
  const deadlineMs = new Date(registrationDeadline).getTime()
  return new Date(Math.min(defaultExpiry, deadlineMs)).toISOString()
}
