// features/dayuse/pricing.ts
// Leitura da configuração de cobrança de day use de uma academia. Existe para
// que a TELA e a COBRANÇA usem a mesma resposta: o card do aluno, a página
// pública e o checkout de `bookDayUse` chamam isto e depois `dayUseChargeCents`,
// em vez de cada um reimplementar "tem preço? a venda está ligada? tem gateway?".
import { getConnectedMpToken } from '@/lib/billing/gatewayAccounts'
import { createAdminClient } from '@/lib/supabase/server'
import { reaisToCents } from '@/lib/dayuse/dayUseKind'

export interface DayUsePricing {
  /** system_settings.day_use_price em centavos — o padrão da academia. */
  defaultCents: number
  /**
   * A academia consegue cobrar: venda ligada E (gateway conectado OU chave PIX
   * configurada). Sem nenhuma forma de cobrar, todo day use sai gratuito.
   *
   * A chave PIX entrou aqui com o pagamento manual: antes disso, arena com
   * venda ligada, preço definido e só PIX entregava day use DE GRAÇA — a tela
   * mostrava o preço e a reserva nascia `confirmed` sem cobrança nenhuma.
   */
  canCharge: boolean
  /** Token do Mercado Pago já decriptado, quando há conta conectada. */
  mpToken: string | null
  /** Chave PIX da academia (system_settings.pix_key), para o pagamento manual. */
  pixKey: string | null
  pixOwner: string | null
}

export async function getDayUsePricing(orgId: string): Promise<DayUsePricing> {
  const admin = createAdminClient()
  const { data: settingsRaw } = await admin
    .from('system_settings')
    .select('key, value')
    .eq('organization_id', orgId)
    .in('key', ['day_use_price', 'day_use_sale_enabled', 'pix_key', 'pix_key_owner'])
  const settings = Object.fromEntries(
    ((settingsRaw ?? []) as { key: string; value: string }[]).map((s) => [s.key, s.value]),
  )
  const defaultCents = reaisToCents(settings.day_use_price)
  const saleEnabled = settings.day_use_sale_enabled === 'true'
  // O token é buscado quando a venda está ligada, mesmo se o padrão da academia
  // for zero: com preço por slot, um slot pago pode existir numa academia cujo
  // padrão é gratuito.
  const mpToken = saleEnabled ? await getConnectedMpToken(orgId) : null
  const pixKey = saleEnabled ? (settings.pix_key?.trim() || null) : null
  return {
    defaultCents,
    canCharge: Boolean(mpToken) || Boolean(pixKey),
    mpToken,
    pixKey,
    pixOwner: settings.pix_key_owner?.trim() || null,
  }
}
