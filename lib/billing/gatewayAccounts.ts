// lib/billing/gatewayAccounts.ts
// Load/save da conta Mercado Pago de cada academia (org_gateway_accounts).
// Tokens são decriptados AQUI e nunca saem de server actions/route handlers.
import { createAdminClient } from '@/lib/supabase/server'
import { decryptSecret, encryptSecret } from './tokenCrypto'
import type { MpOAuthTokens } from './mpClient'

export type GatewayAccountStatus = 'connected' | 'disconnected' | 'expired'

export interface MpAccount {
  organizationId: string
  status: GatewayAccountStatus
  accessToken: string
  refreshToken: string
  mpUserId: string | null
  publicKey: string | null
  tokenExpiresAt: string | null
}

interface AccountRow {
  status: GatewayAccountStatus
  mp_user_id: string | null
  access_token_enc: string
  refresh_token_enc: string
  public_key: string | null
  token_expires_at: string | null
}

export async function getMpAccount(orgId: string): Promise<MpAccount | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('org_gateway_accounts')
    .select('status, mp_user_id, access_token_enc, refresh_token_enc, public_key, token_expires_at')
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()
  if (!data) return null
  const row = data as AccountRow
  return {
    organizationId: orgId,
    status: row.status,
    accessToken: decryptSecret(row.access_token_enc),
    refreshToken: decryptSecret(row.refresh_token_enc),
    mpUserId: row.mp_user_id,
    publicKey: row.public_key,
    tokenExpiresAt: row.token_expires_at,
  }
}

// Token pronto para uso em checkout — null quando não conectado/expirado
// (caller mostra "pagamento online indisponível").
export async function getConnectedMpToken(orgId: string): Promise<string | null> {
  const acc = await getMpAccount(orgId)
  return acc && acc.status === 'connected' ? acc.accessToken : null
}

export async function saveMpAccount(
  orgId: string,
  tokens: MpOAuthTokens,
  connectedBy: string | null,
): Promise<{ error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin.from('org_gateway_accounts').upsert(
    {
      organization_id: orgId,
      gateway: 'mercadopago',
      status: 'connected',
      mp_user_id: tokens.mpUserId,
      access_token_enc: encryptSecret(tokens.accessToken),
      refresh_token_enc: encryptSecret(tokens.refreshToken),
      public_key: tokens.publicKey,
      token_expires_at: tokens.expiresAt,
      ...(connectedBy ? { connected_by: connectedBy } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,gateway' },
  )
  if (error) {
    console.error('[gatewayAccounts] upsert falhou', { orgId, error: error.message })
    return { error: 'Erro ao salvar a conexão.' }
  }
  return {}
}

export async function setMpAccountStatus(
  orgId: string,
  status: GatewayAccountStatus,
): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from('org_gateway_accounts')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('gateway', 'mercadopago')
}
