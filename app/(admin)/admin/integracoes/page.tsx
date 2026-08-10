// app/(admin)/admin/integracoes/page.tsx
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { IntegracoesClient } from './IntegracoesClient'
import type { OrgIntegrationView, PendingCheckin } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'

export const dynamic = 'force-dynamic'

export default async function IntegracoesPage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  // NUNCA selecionar webhook_secret nem api_key aqui: o resultado é serializado para o
  // browser (props de client component). Os segredos são write-only no form, nunca lidos.
  // api_key só é lido como booleano (has_api_key) para a UI mostrar se já está preenchido.
  const [{ data: integrationsRaw }, { data: pendingRaw }, { data: studentsRaw }] = await Promise.all([
    adminClient
      .from('org_integrations')
      .select('id, organization_id, partner, gym_id, status, connected_at, created_at, environment, api_key')
      .eq('organization_id', orgId),
    adminClient
      .from('pending_checkins')
      .select('*')
      .eq('organization_id', orgId)
      .eq('resolved', false)
      .order('created_at', { ascending: false }),
    adminClient
      .from('memberships')
      .select('user_id, profiles:profiles!memberships_user_id_fkey!inner(full_name)')
      .eq('organization_id', orgId)
      .eq('role', 'student')
      .is('archived_at', null),
  ])

  // Deriva has_api_key e descarta o valor cru da api_key antes de serializar p/ o browser.
  const integrations: OrgIntegrationView[] = ((integrationsRaw ?? []) as {
    api_key: string | null
    [k: string]: unknown
  }[]).map(({ api_key, ...rest }) => ({
    ...(rest as Omit<OrgIntegrationView, 'has_api_key'>),
    has_api_key: Boolean(api_key),
  }))
  const pending = (pendingRaw ?? []) as PendingCheckin[]
  const students = ((studentsRaw ?? []) as unknown as {
    user_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[])
    .map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { id: m.user_id, full_name: p?.full_name ?? '' }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  const wellhub = integrations.find((i) => i.partner === 'wellhub') ?? null
  const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/api/webhooks/wellhub`

  return (
    <IntegracoesClient
      wellhub={wellhub}
      pending={pending}
      students={students}
      webhookUrl={webhookUrl}
    />
  )
}
