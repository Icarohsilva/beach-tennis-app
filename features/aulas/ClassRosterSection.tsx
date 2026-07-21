import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { getClassRoster } from './enrollmentRoster'
import { getClassUpcomingSessions } from './adminActions'
import { SkipDateButton } from './SkipDateButton'
import type { EnrollmentStatus } from '@/lib/utils/enrollmentStatus'

const STATUS_META: Record<EnrollmentStatus, { label: string; cls: string }> = {
  elegivel: { label: '✅ Elegível', cls: 'text-green-400 bg-green-500/10 border-green-500/30' },
  a_confirmar: { label: '🔵 Wellhub a confirmar', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  sem_plano: { label: '⚠️ Sem plano', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
}

export async function ClassRosterSection({ classId }: { classId: string }) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()
  const roster = await getClassRoster(adminClient, orgId!, { classId })
  const students = roster.byClass.get(classId)?.students ?? []

  const ids = students.map((s) => s.studentId)
  const { data: profs } = ids.length > 0
    ? await adminClient.from('profiles').select('id, full_name').in('id', ids)
    : { data: [] }
  const nameById = new Map(((profs ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))

  const upcoming = await getClassUpcomingSessions(classId)
  const upSessions = upcoming.sessions ?? []

  // Datas que cada aluno já está pulando (reserva 'cancelled') → pra oferecer "desfazer".
  const upIds = upSessions.map((s) => s.id)
  const { data: skipsRaw } = ids.length > 0 && upIds.length > 0
    ? await adminClient.from('session_bookings').select('student_id, session_id')
        .in('session_id', upIds).in('student_id', ids).eq('status', 'cancelled')
    : { data: [] }
  const skippedByStudent = new Map<string, Set<string>>()
  for (const b of (skipsRaw ?? []) as { student_id: string; session_id: string }[]) {
    const set = skippedByStudent.get(b.student_id) ?? new Set<string>()
    set.add(b.session_id); skippedByStudent.set(b.student_id, set)
  }

  if (students.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum aluno matriculado nesta turma.</p>
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
          return (
            <div key={s.studentId} className="flex items-center gap-3 py-3 border-b border-surface-border last:border-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{nameById.get(s.studentId) ?? 'Aluno'}</p>
                <span className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
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
