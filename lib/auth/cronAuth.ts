import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

// Comparação em tempo constante do header Authorization contra `Bearer <secret>`.
// Função pura (sem req/env) para ser testável isoladamente.
export function isValidCronAuth(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret) return false // fail-closed: sem secret configurado, nada passa
  if (!authHeader) return false
  const received = Buffer.from(authHeader)
  const wanted = Buffer.from(`Bearer ${secret}`)
  // timingSafeEqual lança se os comprimentos diferem — guarda de comprimento primeiro.
  if (received.length !== wanted.length) return false
  return timingSafeEqual(received, wanted)
}

export function verifyCronSecret(req: NextRequest): boolean {
  return isValidCronAuth(req.headers.get('authorization'), process.env.CRON_SECRET)
}
