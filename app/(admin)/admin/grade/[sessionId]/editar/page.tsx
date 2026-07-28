import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { EditClassForm } from '@/features/aulas/EditClassForm'
import { ClassRosterSection } from '@/features/aulas/ClassRosterSection'
import type { Class } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'

export default async function EditClassPage({ params }: { params: { sessionId: string } }) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const classId = params.sessionId
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const { data } = await adminClient.from('classes').select('*').eq('id', classId).eq('organization_id', orgId).single()
  if (!data) notFound()
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">← Grade</Link>
      <h1 className="text-2xl font-bold text-white">Editar Turma</h1>
      <EditClassForm class_={data as Class} />
      <div className="border-t border-surface-border pt-6">
        <ClassRosterSection classId={classId} orgId={orgId!} />
      </div>
    </div>
  )
}
