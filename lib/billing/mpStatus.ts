// lib/billing/mpStatus.ts
// Tradução do status de Preapproval (assinatura) do MercadoPago para o nosso PlatformStatus.
// Retorna null quando o status do MP não tem mapeamento → o webhook NÃO altera o registro.
import type { PlatformStatus } from './platformAccess'

export function mapPreapprovalStatus(mpStatus: string | undefined): PlatformStatus | null {
  switch (mpStatus) {
    case 'authorized':
      return 'active'
    case 'paused':
      return 'past_due'
    case 'cancelled':
      return 'canceled'
    default:
      return null
  }
}
