// features/aulas/creditReconciliation.ts
import { createAdminClient } from '@/lib/supabase/server'
import { getRemainingMonthWindow } from '@/lib/utils/monthWindow'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { reconcileEnrollmentCredits, type ReconcileResult } from './reconcileEnrollment'

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
    .select('student_id, class_id, organization_id')
    .eq('is_active', true)
  if (orgId) enrollQuery = enrollQuery.eq('organization_id', orgId)
  const { data: enrollmentsRaw } = await enrollQuery

  type Row = {
    student_id: string
    class_id: string
    organization_id: string
  }
  const enrollments = (enrollmentsRaw ?? []) as unknown as Row[]

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

  for (const e of enrollments) {
    const memberKey = `${e.student_id}:${e.organization_id}`
    const partner = partnerByMember.get(memberKey) ?? null
    // Elegível para renovar a fixa = tem parceiro OU plano vigente. É a mesma
    // regra que enrollStudentInClass aplica na entrada (spec §2). Plano vencido
    // simplesmente para de ser reservado; a grade sinaliza.
    const eligible = partner !== null || activeSubStudents.has(memberKey)
    if (!eligible) continue

    try {
      const r = await reconcileEnrollmentCredits(e.student_id, e.class_id, from, to, adminClient)
      totals.booked += r.booked
      totals.skipped += r.skipped
      totals.processedEnrollments++
    } catch (err) {
      totals.failed++
      console.error('[reconcileAllActiveEnrollments] matrícula falhou', {
        studentId: e.student_id, classId: e.class_id, organizationId: e.organization_id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

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
