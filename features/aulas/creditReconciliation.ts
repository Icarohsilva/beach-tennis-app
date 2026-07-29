// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { reconcileEnrollmentCredits, type ReconcileResult } from './reconcileEnrollment'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from './quotaSettings'
import { notifyQuotaSkips, type QuotaSkip } from './quotaSkipNotify'
import { computeQuotaBudget } from './quotaBudget'

export type { ReconcileResult }
export { reconcileEnrollmentCredits }

/**
 * Reconcilia matrículas ativas no intervalo [from, to].
 * Inclui apenas alunos com assinatura ativa OU Wellhub/TotalPass.
 *
 * Auditoria #2:
 *  - `orgId` opcional escopa a execução a UMA academia. Isto habilita o
 *    padrão fan-out (um job por arena) para não estourar o timeout serverless
 *    quando houver muitas academias/matrículas.
 *  - Cada matrícula roda dentro de try/catch: uma falha isolada não aborta o
 *    lote inteiro (antes, um erro derrubava toda a renovação mensal).
 */
export async function reconcileAllActiveEnrollments(
  from: string,
  to: string,
  orgId?: string,
): Promise<ReconcileResult & { processedEnrollments: number; failed: number }> {
  const adminClient = createAdminClient()

  let enrollQuery = adminClient
    .from('enrollments')
    .select('student_id, class_id, organization_id, enrolled_at, classes!inner(name, day_of_week, start_time)')
    .eq('is_active', true)
  if (orgId) enrollQuery = enrollQuery.eq('organization_id', orgId)
  const { data: enrollmentsRaw } = await enrollQuery

  type ClassInfo = { name: string; day_of_week: number; start_time: string }
  type Row = {
    student_id: string
    class_id: string
    organization_id: string
    enrolled_at: string
    classes: ClassInfo | ClassInfo[]
  }
  const enrollments = ((enrollmentsRaw ?? []) as unknown as Row[]).map((e) => {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    return {
      studentId: e.student_id,
      classId: e.class_id,
      organizationId: e.organization_id,
      enrolledAt: e.enrolled_at,
      className: cls.name,
      dayOfWeek: cls.day_of_week,
      startTime: cls.start_time,
    }
  })

  // Eixo parceiro é por-academia: indexado por user_id+organization_id.
  let membershipsQuery = adminClient
    .from('memberships')
    .select('user_id, organization_id, partner')
  if (orgId) membershipsQuery = membershipsQuery.eq('organization_id', orgId)
  const { data: membershipsRaw } = await membershipsQuery
  const partnerByMember = new Map<string, string | null>(
    (membershipsRaw ?? []).map(
      (m: { user_id: string; organization_id: string; partner: string | null }) =>
        [`${m.user_id}:${m.organization_id}`, m.partner],
    ),
  )

  // Alunos com assinatura ativa E em dia (por-academia). Assinatura MP com
  // período vencido NÃO renova créditos (spec §3.3) — volta a renovar quando
  // o webhook confirmar a cobrança do período.
  let subsQuery = adminClient
    .from('student_subscriptions')
    .select('student_id, organization_id, gateway, current_period_end')
    .eq('status', 'active')
  if (orgId) subsQuery = subsQuery.eq('organization_id', orgId)
  const { data: subsRaw } = await subsQuery
  const now = new Date()
  const activeSubStudents = new Set(
    ((subsRaw ?? []) as {
      student_id: string
      organization_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => `${s.student_id}:${s.organization_id}`),
  )

  const totals = { booked: 0, skipped: 0, quotaSkipped: 0, processedEnrollments: 0, failed: 0 }
  const skips: QuotaSkip[] = []

  // Cache por academia: dezenas/centenas de alunos do mesmo org não podem
  // repetir a mesma pergunta ("essa academia ligou a cota?") uma vez por
  // aluno — isso reintroduziria o risco de timeout serverless que o fan-out
  // por org (Auditoria #2, abaixo) já existe pra evitar.
  const quotaEnforcedByOrg = new Map<string, boolean>()
  async function isQuotaEnforcedCached(organizationId: string): Promise<boolean> {
    if (!quotaEnforcedByOrg.has(organizationId)) {
      quotaEnforcedByOrg.set(organizationId, await isQuotaEnforced(adminClient, organizationId))
    }
    return quotaEnforcedByOrg.get(organizationId) as boolean
  }

  // Agrupa por aluno (dentro da mesma academia) pra aplicar um orçamento de
  // cota compartilhado entre as fixas dele nesta rodada, na ordem do dia da
  // semana — quem vem mais cedo tem prioridade sobre quem vem depois.
  const byStudent = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const memberKey = `${e.studentId}:${e.organizationId}`
    const partner = partnerByMember.get(memberKey) ?? null
    // Elegível para renovar a fixa = tem parceiro OU plano vigente. É a mesma
    // regra que enrollStudentInClass aplica na entrada (spec §2).
    const eligible = partner !== null || activeSubStudents.has(memberKey)
    if (!eligible) continue
    byStudent.set(memberKey, [...(byStudent.get(memberKey) ?? []), e])
  }

  for (const [memberKey, studentEnrollments] of Array.from(byStudent.entries())) {
    const { studentId, organizationId } = studentEnrollments[0]
    const partner = partnerByMember.get(memberKey) ?? null

    // Orçamento de cota: null = sem limite (parceiro, cota desligada, ou aluno
    // sem plano ativo — este último é uma inconsistência pré-existente fora
    // do escopo, tratada aqui como "sem limite"). `plan` também alimenta o
    // desempate de matrículas excedentes logo abaixo — por isso é buscado
    // aqui, não dentro de computeQuotaBudget.
    const quotaEnforced = !partner && (await isQuotaEnforcedCached(organizationId))
    const plan = quotaEnforced ? await getActivePlan(adminClient, studentId, organizationId) : null
    let budget = await computeQuotaBudget(adminClient, studentId, organizationId, quotaEnforced, plan, partner, from)

    // Mesma regra de "quem conta pro limite" que getQuotaSnapshot usa: as
    // matrículas mais antigas (por enrolled_at) até classesPerWeek são
    // "contadas"/protegidas; as excedentes competem pela cota compartilhada
    // igual uma reserva avulsa. Sem isso, o desempate por dia da semana
    // abaixo inverteria essa proteção sempre que a excedente caísse mais
    // cedo na semana do que a matrícula protegida.
    const countedClassIds = plan
      ? new Set(
          [...studentEnrollments]
            .sort((a, b) => a.enrolledAt.localeCompare(b.enrolledAt))
            .slice(0, plan.classesPerWeek)
            .map((e) => e.classId),
        )
      : null

    const ordered = [...studentEnrollments].sort((a, b) => {
      if (countedClassIds) {
        const aExcess = countedClassIds.has(a.classId) ? 0 : 1
        const bExcess = countedClassIds.has(b.classId) ? 0 : 1
        if (aExcess !== bExcess) return aExcess - bExcess
      }
      return a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)
    })

    for (const e of ordered) {
      try {
        const r = await reconcileEnrollmentCredits(e.studentId, e.classId, from, to, adminClient, budget)
        totals.booked += r.booked
        totals.skipped += r.skipped
        totals.quotaSkipped += r.quotaSkipped
        totals.processedEnrollments++
        if (budget !== null) budget -= r.booked
        if (r.quotaSkipped > 0) {
          skips.push({
            studentId: e.studentId, classId: e.classId, className: e.className, orgId: e.organizationId,
          })
        }
      } catch (err) {
        totals.failed++
        console.error('[reconcileAllActiveEnrollments] matrícula falhou', {
          studentId: e.studentId, classId: e.classId, organizationId: e.organizationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  await notifyQuotaSkips(skips, adminClient)

  return totals
}

/**
 * Lista os ids das academias com pelo menos uma matrícula ativa. Usado pelo
 * dispatcher do cron para processar uma academia por vez (auditoria #2).
 */
export async function listOrgIdsWithActiveEnrollments(): Promise<string[]> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('enrollments')
    .select('organization_id')
    .eq('is_active', true)
  const ids = new Set<string>((data ?? []).map((r: { organization_id: string }) => r.organization_id))
  return Array.from(ids)
}

/** Janela "restante do mês" reexportada para conveniência dos callers. */
export { getRemainingMonthWindow }
