import { createAdminClient } from '@/lib/supabase/server'
import { getClassRoster } from './enrollmentRoster'
import { SkipDateButton } from './SkipDateButton'
import type { EnrollmentStatus } from '@/lib/utils/enrollmentStatus'
import { brtToday } from '@/lib/utils/gridSchedule'
import { ageGroupWarning } from '@/lib/aulas/ageGroup'
import type { AgeGroup, ClassType } from '@/types'

const STATUS_META: Record<EnrollmentStatus, { label: string; cls: string }> = {
  elegivel: { label: '✅ Elegível', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  a_confirmar: { label: '🔵 Parceiro a confirmar', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  sem_plano: { label: '⚠️ Sem plano', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
}

export async function ClassRosterSection({ classId, orgId }: { classId: string; orgId: string }) {
  const adminClient = createAdminClient()
  const roster = await getClassRoster(adminClient, orgId, { classId })
  const students = roster.byClass.get(classId)?.students ?? []

  const ids = students.map((s) => s.studentId)
  const { data: profs } = ids.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))

  // Adulto/kids do aluno e da turma: é aqui que o admin monta a turma, então é aqui
  // que um kids numa turma de adulto precisa saltar aos olhos.
  const [{ data: clsRow }, { data: memsRow }] = await Promise.all([
    adminClient.from('classes').select('type').eq('id', classId).maybeSingle(),
    ids.length > 0
      ? adminClient
          .from('memberships')
          .select('user_id, age_group')
          .eq('organization_id', orgId)
          .in('user_id', ids)
      : Promise.resolve({ data: [] as { user_id: string; age_group: AgeGroup | null }[] }),
  ])
  const classType: ClassType = (clsRow as { type: string } | null)?.type === 'kids' ? 'kids' : 'adult'
  const ageGroupById = new Map(
    ((memsRow ?? []) as { user_id: string; age_group: AgeGroup | null }[]).map((m) => [
      m.user_id,
      m.age_group ?? 'adult',
    ]),
  )

  if (students.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum aluno matriculado nesta turma.</p>
  }

  // Próximas sessões geradas (scheduled, hoje em diante) desta turma. Consulta
  // direta reusando o adminClient/orgId já resolvidos aqui, em vez de disparar
  // um requireAdmin() (auth.getUser() + role query) redundante.
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h
  const { data: upSessionsRaw } = await adminClient
    .from('class_sessions')
    .select('id, session_date')
    .eq('class_id', classId)
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .gte('session_date', today)
    .order('session_date', { ascending: true })
  const upSessions = (upSessionsRaw ?? []) as { id: string; session_date: string }[]

  // Datas que cada aluno já está pulando (reserva 'cancelled') → pra oferecer "desfazer".
  const upIds = upSessions.map((s) => s.id)
  const { data: skipsRaw } = upIds.length > 0
    ? await adminClient.from('session_bookings').select('student_id, session_id')
        .in('session_id', upIds).in('student_id', ids).eq('status', 'cancelled')
    : { data: [] }
  const skippedByStudent = new Map<string, Set<string>>()
  for (const b of (skipsRaw ?? []) as { student_id: string; session_id: string }[]) {
    const set = skippedByStudent.get(b.student_id) ?? new Set<string>()
    set.add(b.session_id); skippedByStudent.set(b.student_id, set)
  }

  return (
    <div className="space-y-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
        Alunos da turma <span className="text-slate-500 font-normal">({students.length})</span>
      </h2>
      {students
        .slice()
        .sort((a, b) => (nameById.get(a.studentId) ?? '').localeCompare(nameById.get(b.studentId) ?? '', 'pt-BR'))
        .map((s) => {
          const meta = STATUS_META[s.status]
          const avisoTipo = ageGroupWarning(ageGroupById.get(s.studentId) ?? 'adult', classType)
          return (
            <div key={s.studentId} className="flex items-center gap-3 py-3 border-b border-surface-border last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{nameById.get(s.studentId) ?? 'Aluno'}</p>
                <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
                {avisoTipo && (
                  <span className="ml-1 inline-block mt-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-semibold text-yellow-400">
                    ⚠️ {avisoTipo}
                  </span>
                )}
              </div>
              <SkipDateButton
                studentId={s.studentId}
                sessions={upSessions.map((u) => ({ ...u, skipped: skippedByStudent.get(s.studentId)?.has(u.id) ?? false }))}
              />
            </div>
          )
        })}
    </div>
  )
}
