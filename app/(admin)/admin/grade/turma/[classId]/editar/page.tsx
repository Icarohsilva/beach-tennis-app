import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { EditClassForm } from '@/features/aulas/EditClassForm'
import { ClassRosterSection } from '@/features/aulas/ClassRosterSection'
import type { Class } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { getOrgSports } from '@/lib/arenas/orgSports'

// Edita a TURMA recorrente — nome, dia, horário, quadra, lotação — e vale para
// todas as semanas seguintes. Para mexer numa data só (remarcar a terça,
// cancelar por chuva) o lugar é a ficha da aula, /admin/grade/[sessionId].
//
// Esta página morava em /admin/grade/[sessionId]/editar e recebia um id de
// TURMA no parâmetro chamado `sessionId`. Duas entidades no mesmo segmento da
// URL: o calendário do painel montava o link com o id da sessão, batia aqui e
// caía em 404. O caminho agora diz o que recebe.
export default async function EditClassPage({ params }: { params: { classId: string } }) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const { classId } = params
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const { data } = await adminClient.from('classes').select('*').eq('id', classId).eq('organization_id', orgId).single()
  if (!data) notFound()
  const orgSports = await getOrgSports(orgId)
  return (
    <div className="space-y-6 max-w-2xl">
      <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">← Grade</Link>
      <h1 className="text-2xl font-bold text-white">Editar Turma</h1>
      <EditClassForm class_={data as Class} orgSports={orgSports} />
      <div className="border-t border-surface-border pt-6">
        <ClassRosterSection classId={classId} orgId={orgId!} />
      </div>
    </div>
  )
}
