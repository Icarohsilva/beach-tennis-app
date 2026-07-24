// app/(super-admin)/super-admin/page.tsx
import Link from 'next/link'
import { listOrganizations } from '@/features/super-admin/actions'
import { OrgList } from './OrgList'

export default async function SuperAdminHome() {
  const { rows, error } = await listOrganizations()
  if (error) return <p className="text-sm text-red-400">{error}</p>
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Academias</h1>
          <p className="text-sm text-slate-400">{rows?.length ?? 0} cadastradas</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/super-admin/feedback"
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 hover:bg-surface-border transition-colors"
          >
            Feedback
          </Link>
          <Link
            href="/super-admin/exclusoes"
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 hover:bg-surface-border transition-colors"
          >
            Exclusões
          </Link>
          <Link
            href="/super-admin/reembolsos"
            className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-slate-200 hover:bg-surface-border transition-colors"
          >
            Reembolsos
          </Link>
        </div>
      </div>
      <OrgList rows={rows ?? []} />
    </div>
  )
}
