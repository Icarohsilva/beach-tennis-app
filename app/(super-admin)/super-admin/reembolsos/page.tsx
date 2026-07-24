// app/(super-admin)/super-admin/reembolsos/page.tsx
import { createAdminClient } from '@/lib/supabase/server'
import { RefundRequestList, type RefundRequestRow } from './RefundRequestList'

interface QueryRow {
  id: string
  reason: string | null
  status: RefundRequestRow['status']
  created_at: string
  organization_id: string
  requested_by: string
  profiles: { full_name: string } | { full_name: string }[] | null
  organizations: { name: string } | { name: string }[] | null
}

export default async function ReembolsosPage() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('platform_refund_requests')
    .select('id, reason, status, created_at, organization_id, requested_by, profiles!platform_refund_requests_requested_by_fkey(full_name), organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return <p className="text-sm text-red-400">Erro ao carregar solicitações.</p>

  const rows: RefundRequestRow[] = ((data ?? []) as unknown as QueryRow[]).map((r) => {
    const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    const organization = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations
    return {
      id: r.id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      author: profile?.full_name ?? '—',
      orgName: organization?.name ?? '—',
    }
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Reembolsos</h1>
        <p className="text-sm text-slate-400">{rows.length} solicitações</p>
      </div>
      <RefundRequestList rows={rows} />
    </div>
  )
}
