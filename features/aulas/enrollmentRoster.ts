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
  enrolled: number
  eligible: number
  pendingConfirmation: number
  noPlan: number
  students: RosterStudent[]
}
export interface Roster {
  byClass: Map<string, ClassRosterCounts>
  totals: { enrolled: number; eligible: number; pendingConfirmation: number; noPlan: number }
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

  const empty: Roster = { byClass: new Map(), totals: { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0 } }
  if (classIds.length === 0) return empty

  const { data: enrollRaw } = await client
    .from('enrollments').select('class_id, student_id')
    .in('class_id', classIds).eq('organization_id', orgId).eq('is_active', true)
  const enrolls = (enrollRaw ?? []) as { class_id: string; student_id: string }[]
  if (enrolls.length === 0) {
    for (const id of classIds) empty.byClass.set(id, { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0, students: [] })
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
  for (const id of classIds) byClass.set(id, { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0, students: [] })
  const totals = { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0 }

  for (const e of enrolls) {
    // class_id fora do escopo atual (ex.: excluído por opts.dayOfWeek/classId, ou
    // uma turma que virou inativa entre a query de classes e a de enrollments):
    // ignora em vez de estourar. Não deveria ocorrer com o client real (a query
    // já filtra por .in('class_id', classIds)), mas blindar é barato e evita
    // acoplar a corretude a uma invariante só garantida do lado do banco.
    const c = byClass.get(e.class_id)
    if (!c) continue
    const mem = memById.get(e.student_id)
    const status = classifyEnrollment({
      partner: mem?.partner ?? null,
      pendingPartner: mem?.pending_partner ?? null,
      hasActivePlan: planStudents.has(e.student_id),
    })
    c.enrolled++; totals.enrolled++
    if (status === 'elegivel') { c.eligible++; totals.eligible++ }
    else if (status === 'a_confirmar') { c.pendingConfirmation++; totals.pendingConfirmation++ }
    else { c.noPlan++; totals.noPlan++ }
    c.students.push({ studentId: e.student_id, classId: e.class_id, status })
  }

  return { byClass, totals }
}
