// app/(super-admin)/super-admin/page.tsx
import { listOrganizations } from '@/features/super-admin/actions'
import { OrgList } from './OrgList'

export default async function SuperAdminHome() {
  const { rows, error } = await listOrganizations()
  if (error) return <p className="text-sm text-red-400">{error}</p>
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Academias</h1>
        <p className="text-sm text-slate-400">{rows?.length ?? 0} cadastradas</p>
      </div>
      <OrgList rows={rows ?? []} />
    </div>
  )
}
