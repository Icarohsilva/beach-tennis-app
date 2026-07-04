// app/(admin)/admin/financeiro/integracoes/page.tsx
import { createAdminClient, requireOwner } from '@/lib/supabase/server'
import { FinanceiroSubnav } from '../FinanceiroSubnav'
import { MpConnectCard } from './MpConnectCard'
import { GatewayRequestCard } from './GatewayRequestCard'
import type { GatewayIntegrationRequest } from '@/types'

export default async function IntegracoesPage() {
  const ctx = await requireOwner()
  const adminClient = createAdminClient()

  // Status da conexão SEM tokens (nunca mandar tokens ao client).
  const { data: account } = await adminClient
    .from('org_gateway_accounts')
    .select('status, mp_user_id, token_expires_at')
    .eq('organization_id', ctx.organizationId)
    .eq('gateway', 'mercadopago')
    .maybeSingle()

  const { data: requestsRaw } = await adminClient
    .from('gateway_integration_requests')
    .select('*')
    .eq('organization_id', ctx.organizationId)
    .order('created_at', { ascending: false })
  const requests: GatewayIntegrationRequest[] = requestsRaw ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Integrações</h1>
        <p className="text-slate-400 text-sm mt-1">
          Conecte o gateway de pagamento da academia para receber dos alunos pelo app
        </p>
      </div>
      <FinanceiroSubnav />

      <MpConnectCard
        account={
          account
            ? {
                status: account.status as 'connected' | 'disconnected' | 'expired',
                mpUserId: (account.mp_user_id as string | null) ?? null,
                tokenExpiresAt: (account.token_expires_at as string | null) ?? null,
              }
            : null
        }
      />

      <GatewayRequestCard requests={requests} />
    </div>
  )
}
