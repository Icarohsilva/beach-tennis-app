// features/aulas/enrollmentRoster.ts
// Roster de alunos por turma com status (spec 2026-07-21 §1). Fonte única
// reusada pela grade, pelo feedback do "Gerar" e pelo editar-turma.
import type { createAdminClient } from '@/lib/supabase/server'
import { classifyEnrollment, type EnrollmentStatus } from '@/lib/utils/enrollmentStatus'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import type { CheckinPartner } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface RosterStudent {
  studentId: string
  classId: string
  status: EnrollmentStatus
}
export interface ClassRosterCounts {
  matriculados: number
  elegivel: number
  aConfirmar: number
  semPlano: number
  students: RosterStudent[]
}
export interface Roster {
  byClass: Map<string, ClassRosterCounts>
  totals: { matriculados: number; elegivel: number; aConfirmar: number; semPlano: number }
}

export async function getClassRoster(
  client: AdminClient,
  orgId: string,
  opts: { dayOfWeek?: number; classId?: string } = {},
): Promise<Roster> {
  let clsQ = client.from('classes').select('id, day_of_week').eq('organization_id', orgId).eq('is_active', true)
  if (opts.dayOfWeek !== undefined) clsQ = clsQ.eq('day_of_week', opts.dayOfWeek)
  if (opts.classId !== undefined) clsQ = clsQ.eq('id', opts.classId)
  const { data: classesRaw } = await clsQ
  const classIds = ((classesRaw ?? []) as { id: string }[]).map((c) => c.id)

  const empty: Roster = { byClass: new Map(), totals: { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0 } }
  if (classIds.length === 0) return empty

  const { data: enrollRaw } = await client
    .from('enrollments').select('class_id, student_id')
    .in('class_id', classIds).eq('organization_id', orgId).eq('is_active', true)
  const enrolls = (enrollRaw ?? []) as { class_id: string; student_id: string }[]
  if (enrolls.length === 0) {
    for (const id of classIds) empty.byClass.set(id, { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0, students: [] })
    return empty
  }

  const studentIds = Array.from(new Set(enrolls.map((e) => e.student_id)))

  const { data: memsRaw } = await client
    .from('memberships').select('user_id, partner, pending_partner')
    .in('user_id', studentIds).eq('organization_id', orgId)
  const memById = new Map(
    ((memsRaw ?? []) as { user_id: string; partner: CheckinPartner | null; pending_partner: CheckinPartner | null }[])
      .map((m) => [m.user_id, m]),
  )

  const { data: subsRaw } = await client
    .from('student_subscriptions').select('student_id, gateway, current_period_end')
    .in('student_id', studentIds).eq('organization_id', orgId).eq('status', 'active')
  const now = new Date()
  const planStudents = new Set(
    ((subsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, now)).map((s) => s.student_id),
  )

  const byClass = new Map<string, ClassRosterCounts>()
  for (const id of classIds) byClass.set(id, { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0, students: [] })
  const totals = { matriculados: 0, elegivel: 0, aConfirmar: 0, semPlano: 0 }

  for (const e of enrolls) {
    const mem = memById.get(e.student_id)
    const status = classifyEnrollment({
      partner: mem?.partner ?? null,
      pendingPartner: mem?.pending_partner ?? null,
      hasActivePlan: planStudents.has(e.student_id),
    })
    const c = byClass.get(e.class_id)!
    c.matriculados++; totals.matriculados++
    if (status === 'elegivel') { c.elegivel++; totals.elegivel++ }
    else if (status === 'a_confirmar') { c.aConfirmar++; totals.aConfirmar++ }
    else { c.semPlano++; totals.semPlano++ }
    c.students.push({ studentId: e.student_id, classId: e.class_id, status })
  }

  return { byClass, totals }
}
