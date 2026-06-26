// app/(admin)/admin/integracoes/page.tsx
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { IntegracoesClient } from './IntegracoesClient'
import type { OrgIntegration, PendingCheckin } from '@/types'

export const dynamic = 'force-dynamic'

export default async function IntegracoesPage() {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  const [{ data: integrationsRaw }, { data: pendingRaw }, { data: studentsRaw }] = await Promise.all([
    adminClient.from('org_integrations').select('*').eq('organization_id', orgId),
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
      .eq('role', 'student'),
  ])

  const integrations = (integrationsRaw ?? []) as OrgIntegration[]
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
