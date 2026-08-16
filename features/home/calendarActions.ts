'use server'
// features/home/calendarActions.ts
// Troca de mês no calendário da home.
//
// Uma action e não um parâmetro de URL: a home faz mais de dez consultas para
// montar hero, frequência e agenda da semana, e refazer tudo isso só porque o
// aluno tocou na seta do mês seguinte seria um recarregamento inteiro por
// clique. Aqui só a janela do calendário é rebuscada.
import {
  createAdminClient,
  getActiveMembership,
  getActiveOrgId,
  getAuthUser,
} from '@/lib/supabase/server'
import { getArenaMonth } from './arenaMonthQuery'
import { buildAgendaSessions, type SessionRowWithClass } from './sessionDetailQuery'
import { getActivePlan } from '@/lib/billing/planEligibility'
import { isQuotaEnforced } from '@/features/aulas/quotaSettings'
import { getQuotaSnapshot } from '@/features/aulas/quotaUsage'
import { brtToday } from '@/lib/utils/gridSchedule'
import type { AgendaSession } from './agendaTypes'
import type { ArenaEvent } from '@/lib/home/arenaAgenda'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export async function loadArenaMonth(monthISO: string): Promise<ArenaEvent[]> {
  // O mês vem do cliente: sem validar, um valor torto viraria data inválida no
  // filtro e a query voltaria vazia (ou com o mês errado) sem explicação.
  if (!MONTH_RE.test(monthISO)) return []

  const user = await getAuthUser()
  if (!user) return []
  const orgId = await getActiveOrgId()
  if (!orgId) return []

  return getArenaMonth({ orgId, userId: user.id, monthISO })
}

/**
 * Ficha completa de uma aula, para o calendário abrir o mesmo modal da faixa da
 * semana.
 *
 * O calendário do mês carrega só o esqueleto do evento (título, hora, ocupação),
 * porque montar presentes e fila de espera de um mês inteiro seria caro e quase
 * tudo seria jogado fora. A ficha vem sob demanda, quando o aluno toca no dia.
 *
 * Devolve null quando a sessão não existe, não é da academia ativa ou não está
 * mais agendada — nesse caso a tela não abre modal nenhum.
 */
export async function loadSessionDetail(sessionId: string): Promise<AgendaSession | null> {
  const user = await getAuthUser()
  if (!user) return null
  const orgId = await getActiveOrgId()
  if (!orgId) return null
  const membership = await getActiveMembership()

  const adminClient = createAdminClient()

  const { data: row } = await adminClient
    .from('class_sessions')
    .select(
      'id, session_date, class_id, status, cancelled_reason, start_time, end_time, court, max_students, classes(name, start_time, end_time, type, sport, max_students, court)',
    )
    .eq('id', sessionId)
    .eq('organization_id', orgId)
    .in('status', ['scheduled', 'cancelled'])
    .maybeSingle()

  if (!row) return null

  const { data: enrollRaw } = await adminClient
    .from('enrollments')
    .select('class_id')
    .eq('student_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('self_checkin_enabled')
    .eq('id', orgId)
    .maybeSingle()

  // Mesma leitura de cota que a home faz para o cabeçalho — aqui ela decide se a
  // ficha pergunta como o aluno quer pagar.
  const plan = await getActivePlan(adminClient, user.id, orgId)
  const quotaOn = await isQuotaEnforced(adminClient, orgId)
  const quota =
    quotaOn && plan
      ? await getQuotaSnapshot(adminClient, user.id, orgId, plan, brtToday(new Date()))
      : null

  const sessions = await buildAgendaSessions(adminClient, {
    orgId,
    userId: user.id,
    partner: membership?.partner ?? null,
    selfCheckinEnabled:
      (orgRow as { self_checkin_enabled: boolean } | null)?.self_checkin_enabled ?? false,
    enrolledClassIds: new Set(
      ((enrollRaw ?? []) as { class_id: string }[]).map((e) => e.class_id),
    ),
    rows: [row as unknown as SessionRowWithClass],
    creditsBalance: membership?.credits_balance ?? 0,
    hasPlanQuota: plan !== null && (!quotaOn || (quota?.remaining ?? 0) > 0),
  })

  return sessions[0] ?? null
}
