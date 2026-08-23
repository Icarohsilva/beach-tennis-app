// features/aulas/classAccessQuery.ts
// "Este aluno pode entrar nesta aula?" — a coleta de dados que alimenta
// `resolveClassAccess` (lib/utils/accessRules.ts), num lugar só.
//
// Existe porque a mesma pergunta é feita em TRÊS momentos e as respostas têm de
// ser idênticas:
//   1. reservar a aula            (bookSessionAs)
//   2. entrar na fila de espera   (joinWaitlistAs)  — antes não checava nada,
//      então dava para entrar na fila com dívida e descobrir só na promoção
//   3. entrar automaticamente pela fila (promoteFromWaitlist)
//
// Três cópias divergiriam, e é o mesmo motivo de `mergeSessionAttendees` e
// `buildClassRules` existirem. A regra em si continua pura em accessRules.
import type { createAdminClient } from '@/lib/supabase/server'
import { resolveClassAccess, exceedsDailyCap, type AccessDecision } from '@/lib/utils/accessRules'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { getQuotaSnapshot } from './quotaUsage'
import { isQuotaEnforced, getOrgMaxClassesPerDay } from './quotaSettings'
import { getDebtGraceDays } from '@/features/financeiro/debtQueries'
import { summarizeDebts } from '@/lib/utils/debtRules'
import {
  countOpenMissedCheckins,
  getMissedCheckinSettings,
} from '@/features/checkin/missedCheckinSettings'
import { getApprovedVacations } from './vacationQueries'
import { isOnVacation } from '@/lib/aulas/vacation'
import type { Membership } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Membership do aluno na academia, por id explícito.
 *
 * `getActiveMembership()` só serve para o próprio usuário logado; o responsável
 * que inscreve o filho precisa da membership DO FILHO — é ela que tem o crédito,
 * o plano e o `is_dependent` que a turma kids exige. A promoção pela fila tem o
 * mesmo problema: quem dispara é quem cancelou, e a regra é de outra pessoa.
 */
export async function getMembershipFor(
  adminClient: AdminClient,
  studentId: string,
  orgId: string,
): Promise<Membership | null> {
  const { data } = await adminClient
    .from('memberships')
    .select('*')
    .eq('user_id', studentId)
    .eq('organization_id', orgId)
    .maybeSingle()
  return (data as Membership) ?? null
}

export interface StudentClassAccess {
  decision: AccessDecision
  /** Teto diário efetivo: o do plano, ou o padrão da academia. 0 = sem teto. */
  dailyCap: number
  /**
   * Estourou o teto diário nesta data?
   *
   * `null` = não avaliado, porque o teto não se aplica a esta reserva (pagamento
   * com crédito, volta à aula fixa, ou teto 0). Distinguir de `false` importa: a
   * contagem custa duas queries e só é feita quando pode mudar a resposta.
   */
  dailyCapExceeded: boolean | null
  /** Aulas do ciclo, quando a academia cobra cota. */
  quotaLimit: number | null
  planCycle: string | null
  openMissedCheckins: number
  debtTotal: number
  creditsBalance: number
}

/**
 * Junta plano, cota, teto diário, dívida, pendência de check-in e férias, e
 * devolve o veredito de `resolveClassAccess` com os números que as mensagens de
 * erro precisam.
 *
 * `membership` entra pronta de propósito: quem chama já a buscou (para o corte
 * de turma kids, que é anterior a tudo isto) e buscar de novo aqui seria uma
 * query a mais no caminho quente da reserva.
 */
export async function resolveStudentClassAccess(
  adminClient: AdminClient,
  input: {
    studentId: string
    orgId: string
    /** YYYY-MM-DD da sessão — cota e teto diário são medidos nesta data. */
    sessionDate: string
    membership: Membership
    /** O aluno escolheu pagar esta aula com crédito avulso. */
    preferCredit?: boolean
    /**
     * Pula os eixos de CUSTO (cota, teto diário, débito). É a volta do aluno
     * fixo à aula da qual ele saiu: a vaga já foi paga pela matrícula. As
     * negações de situação continuam valendo.
     */
    skipCostAxes?: boolean
  },
): Promise<StudentClassAccess> {
  const { studentId, orgId, sessionDate, membership } = input
  const preferCredit = input.preferCredit ?? false
  const skipCostAxes = input.skipCostAxes ?? false

  // Plano vigente: 'active' com período vencido NÃO dá acesso — mesmo critério
  // da reconciliação (spec §1). getActivePlan devolve a configuração de cota,
  // não só o sim/não: a cota precisa de classes_per_week, cycle e max_classes_per_day.
  const plan = await getActivePlan(adminClient, studentId, orgId)
  const hasActivePlan = plan !== null

  const quotaEnforced = await isQuotaEnforced(adminClient, orgId)
  const orgDailyCap = await getOrgMaxClassesPerDay(adminClient, orgId)

  // Só paga o custo das queries da cota quando a academia ligou a regra e a cota
  // ainda importa para esta reserva.
  const snapshot =
    quotaEnforced && plan && !preferCredit && !skipCostAxes
      ? await getQuotaSnapshot(adminClient, studentId, orgId, plan, sessionDate)
      : null

  // 0 = sem teto (ver exceedsDailyCap).
  const dailyCap = plan?.maxClassesPerDay ?? orgDailyCap

  // Teto diário medido direto nas reservas da data. Roda mesmo com a cota
  // desligada — por isso não sai do snapshot, que só existe quando há cota.
  let dailyCapExceeded: boolean | null = null
  if (!preferCredit && !skipCostAxes && dailyCap > 0) {
    const { data: sameDay } = await adminClient
      .from('class_sessions')
      .select('id')
      .eq('organization_id', orgId)
      .eq('session_date', sessionDate)

    const { count: dailyCount } = await adminClient
      .from('session_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .in('session_id', (sameDay ?? []).map((s: { id: string }) => s.id))

    dailyCapExceeded = exceedsDailyCap(dailyCount ?? 0, dailyCap)
  }

  // Dívida aberta = payments pendente COM session_id. O filtro de session_id é
  // essencial: compra de crédito abandonada no checkout também fica 'pending',
  // mas com session_id null — sem o filtro ela bloquearia o aluno para sempre
  // (spec §4). Ter pendência não basta: precisa ter valor e ter passado a
  // carência (spec cobrança §2), senão uma dívida de R$ 0 (academia sem preço
  // configurado) travava o aluno indefinidamente.
  const { data: debtRows } = await adminClient
    .from('payments')
    .select('id, amount, created_at, receipt_url')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .not('session_id', 'is', null)
    // A pendência de check-in também vive em payments, mas tem regra própria
    // (limite de contagem, não carência). Sem este filtro a mesma falta
    // bloquearia por dois caminhos, um deles não configurado pela academia.
    .eq('missed_checkin', false)

  const graceDays = await getDebtGraceDays(adminClient, orgId)
  const debtSummary = summarizeDebts(
    (
      (debtRows ?? []) as {
        id: string
        amount: number
        created_at: string
        receipt_url: string | null
      }[]
    ).map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      createdAt: r.created_at,
      receiptUrl: r.receipt_url,
    })),
    graceDays,
    new Date(),
  )

  // Pendência de check-in do parceiro. Só busca para quem tem parceiro — é o
  // único aluno que pode ter pendência, e este é caminho quente.
  const { blockLimit: missedCheckinBlockLimit } = membership.partner
    ? await getMissedCheckinSettings(adminClient, orgId)
    : { blockLimit: 0 }
  const openMissedCheckins =
    membership.partner && missedCheckinBlockLimit > 0
      ? await countOpenMissedCheckins(adminClient, studentId, orgId)
      : 0

  // Férias aprovadas cobrindo a data: o aluno declarou ausência, e a grade já
  // foi gerada sem ele. Deixar entrar aqui contradiria o próprio pedido dele.
  const vacations = await getApprovedVacations(adminClient, studentId, orgId, sessionDate)

  const decision = resolveClassAccess({
    archived: Boolean(membership.archived_at),
    onVacation: isOnVacation(vacations, sessionDate),
    partner: membership.partner,
    hasActivePlan,
    creditsBalance: membership.credits_balance,
    hasOpenDebt: debtSummary.isBlocked,
    openMissedCheckins,
    missedCheckinBlockLimit,
    // Volta à aula fixa não consome plano: desligar a cota aqui é o que faz
    // `resolveClassAccess` pular 'quota_exhausted' e 'daily_cap' sem
    // reimplementar a ordem das negações fora dela.
    quotaEnforced: skipCostAxes ? false : quotaEnforced,
    quotaRemaining: snapshot?.remaining ?? null,
    bookingsOnDate: snapshot?.bookingsOnDate ?? 0,
    maxClassesPerDay: skipCostAxes ? 0 : dailyCap,
    preferCredit,
  })

  return {
    decision,
    dailyCap,
    dailyCapExceeded,
    quotaLimit: snapshot?.limit ?? null,
    planCycle: plan?.cycle ?? null,
    openMissedCheckins,
    debtTotal: debtSummary.total,
    creditsBalance: membership.credits_balance,
  }
}
