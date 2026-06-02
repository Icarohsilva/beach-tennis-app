import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { EditClassForm } from '@/features/aulas/EditClassForm'
import type { Class } from '@/types'

export default async function EditClassPage({ params }: { params: { sessionId: string } }) {
  const classId = params.sessionId
  const adminClient = createAdminClient()
  const { data } = await adminClient.from('classes').select('*').eq('id', classId).single()
  if (!data) notFound()
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">← Grade</Link>
      <h1 className="text-2xl font-bold text-white">Editar Turma</h1>
      <EditClassForm class_={data as Class} />
    </div>
  )
}
