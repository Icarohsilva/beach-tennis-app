'use server'
// features/financeiro/gatewayActions.ts
// Conexão OAuth do Mercado Pago da academia + solicitações de outros gateways.
// Tudo owner-only (financeiro é área do dono).
import { revalidatePath } from 'next/cache'
import { requireOwner, createAdminClient } from '@/lib/supabase/server'
import { createOAuthState } from '@/lib/billing/oauthState'
import { setMpAccountStatus } from '@/lib/billing/gatewayAccounts'
import { getSiteUrl } from '@/lib/utils/siteUrl'

// URL de autorização do MP para o dono conectar a conta da academia.
// O client faz window.location.href = url (redirect não funciona em action
// chamada de componente client com startTransition).
export async function getMercadoPagoAuthUrl(): Promise<{ url?: string; error?: string }> {
  const ctx = await requireOwner() // não-dono → redirect; aqui já é owner
  const appId = process.env.MP_APP_ID
  const secret = process.env.MP_APP_SECRET
  if (!appId || !secret) {
    return { error: 'Integração indisponível no momento. Tente mais tarde.' }
  }
  const state = createOAuthState({ orgId: ctx.organizationId, userId: ctx.userId }, secret)
  const redirectUri = `${getSiteUrl()}/api/integrations/mercadopago/callback`
  const params = new URLSearchParams({
    client_id: appId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
  })
  return { url: `https://auth.mercadopago.com.br/authorization?${params.toString()}` }
}

// Desconecta: novos checkouts bloqueados; assinaturas MP existentes seguem
// sendo processadas pelo webhook (spec §2 item 5).
export async function disconnectMercadoPago(): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  await setMpAccountStatus(ctx.organizationId, 'disconnected')
  revalidatePath('/admin/financeiro/integracoes')
  return {}
}

export async function requestGatewayIntegration(
  gatewayName: string,
  notes: string,
): Promise<{ error?: string }> {
  const ctx = await requireOwner()
  const name = gatewayName.trim()
  if (!name) return { error: 'Informe o nome do banco/gateway.' }
  if (name.length > 80) return { error: 'Nome muito longo.' }

  const admin = createAdminClient()
  const { error } = await admin.from('gateway_integration_requests').insert({
    organization_id: ctx.organizationId,
    requested_by: ctx.userId,
    gateway_name: name,
    notes: notes.trim() || null,
  })
  if (error) return { error: 'Erro ao registrar a solicitação.' }
  revalidatePath('/admin/financeiro/integracoes')
  return {}
}
