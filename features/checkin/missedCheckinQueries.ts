// features/checkin/missedCheckinQueries.ts
// Leitura consolidada do Controle Wellhub: um aluno de parceiro por linha, com
// progresso do mês e pendências. Mesmo papel de features/financeiro/debtQueries.ts.
import type { createAdminClient } from '@/lib/supabase/server'
import { countDistinctDays } from '@/lib/checkin/monthlyProgress'
import { computeProgress, type CheckinProgress } from '@/lib/checkin/progress'
import {
  summarizeMissedCheckins,
  type MissedCheckinRow,
  type MissedCheckinSummary,
} from '@/lib/checkin/missedCheckins'
import { getOrgDefaultCheckinTarget } from '@/lib/checkin/orgCheckinTarget'
import { getMissedCheckinSettings } from './missedCheckinSettings'
import type { DateWindow } from '@/lib/utils/monthWindow'
import type { CheckinPartner, MissedCheckinStatus } from '@/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WellhubPendency extends MissedCheckinRow {
  className: string
  hasPayment: boolean
}

export interface WellhubStudentRow {
  studentId: string
  fullName: string
  phone: string | null
  partner: CheckinPartner
  progress: CheckinProgress
  summary: MissedCheckinSummary
  /** Todas as pendências do aluno na janela, inclusive resolvidas (histórico). */
  pendencies: WellhubPendency[]
}

export interface WellhubOverview {
  blockLimit: number
  price: number
  students: WellhubStudentRow[]
  totals: {
    partnerStudents: number
    /** Dias distintos com check-in somados na academia. */
    checkinDays: number
    openCount: number
    openAmount: number
    /** Abertas + perdoadas: o que a academia deixou de receber na janela. */
    lostAmount: number
    blockedStudents: number
    belowTarget: number
  }
}

/**
 * Monta a visão da academia na janela informada.
 *
 * As pendências são filtradas pela JANELA (session_date), então trocar o mês na tela
 * também vira histórico. O bloqueio, ao contrário, olha as abertas de qualquer data —
 * uma pendência de março continua bloqueando em julho. Por isso `summary` é calculado
 * sobre as abertas totais, não sobre as da janela.
 */
export async function getWellhubOverview(
  client: AdminClient,
  orgId: string,
  window: DateWindow,
): Promise<WellhubOverview> {
  const { blockLimit, price } = await getMissedCheckinSettings(client, orgId)
  const defaultTarget = await getOrgDefaultCheckinTarget(client, orgId)

  // Dependentes NÃO são filtrados: um dependente de parceiro conta igual a qualquer
  // aluno, mesma regra do repasse em partnerRevenueActions.
  const { data: memsRaw } = await client
    .from('memberships')
    .select('user_id, partner, monthly_checkin_target')
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .not('partner', 'is', null)

  type MemRow = {
    user_id: string
    partner: CheckinPartner
    monthly_checkin_target: number | null
  }
  const mems = (memsRaw ?? []) as MemRow[]

  const empty: WellhubOverview = {
    blockLimit,
    price,
    students: [],
    totals: {
      partnerStudents: 0,
      checkinDays: 0,
      openCount: 0,
      openAmount: 0,
      lostAmount: 0,
      blockedStudents: 0,
      belowTarget: 0,
    },
  }
  if (mems.length === 0) return empty

  const studentIds = mems.map((m) => m.user_id)

  const [{ data: profsRaw }, { data: checkinsRaw }, { data: windowRaw }, { data: openRaw }] =
    await Promise.all([
      client.from('profiles').select('id, full_name, phone').in('id', studentIds),
      client
        .from('checkins')
        .select('student_id, checkin_date')
        .eq('organization_id', orgId)
        .in('student_id', studentIds)
        .gte('checkin_date', window.from)
        .lte('checkin_date', window.to),
      // Pendências da janela, com o nome da turma para a mensagem e o histórico.
      client
        .from('missed_checkins')
        .select('id, student_id, session_date, amount, status, payment_id, class_sessions(classes(name))')
        .eq('organization_id', orgId)
        .in('student_id', studentIds)
        .gte('session_date', window.from)
        .lte('session_date', window.to)
        .order('session_date', { ascending: false }),
      // Abertas de QUALQUER data: é o que governa o bloqueio.
      client
        .from('missed_checkins')
        .select('id, student_id, session_date, amount, status')
        .eq('organization_id', orgId)
        .in('student_id', studentIds)
        .eq('status', 'open'),
    ])

  const profById = new Map(
    ((profsRaw ?? []) as { id: string; full_name: string; phone: string | null }[]).map((p) => [
      p.id,
      p,
    ]),
  )

  const checkinsByStudent = new Map<string, { checkin_date: string }[]>()
  for (const c of (checkinsRaw ?? []) as { student_id: string; checkin_date: string }[]) {
    checkinsByStudent.set(c.student_id, [
      ...(checkinsByStudent.get(c.student_id) ?? []),
      { checkin_date: c.checkin_date },
    ])
  }

  type WindowRow = {
    id: string
    student_id: string
    session_date: string
    amount: number | string
    status: MissedCheckinStatus
    payment_id: string | null
    class_sessions: { classes: { name: string } | { name: string }[] } | null
  }
  const pendenciesByStudent = new Map<string, WellhubPendency[]>()
  for (const r of (windowRaw ?? []) as unknown as WindowRow[]) {
    const sessions = Array.isArray(r.class_sessions) ? r.class_sessions[0] : r.class_sessions
    const classes = Array.isArray(sessions?.classes) ? sessions?.classes[0] : sessions?.classes
    pendenciesByStudent.set(r.student_id, [
      ...(pendenciesByStudent.get(r.student_id) ?? []),
      {
        id: r.id,
        sessionDate: r.session_date,
        amount: Number(r.amount),
        status: r.status,
        className: classes?.name ?? 'Aula',
        hasPayment: !!r.payment_id,
      },
    ])
  }

  type OpenRow = {
    id: string
    student_id: string
    session_date: string
    amount: number | string
    status: MissedCheckinStatus
  }
  const openByStudent = new Map<string, MissedCheckinRow[]>()
  for (const r of (openRaw ?? []) as OpenRow[]) {
    openByStudent.set(r.student_id, [
      ...(openByStudent.get(r.student_id) ?? []),
      { id: r.id, sessionDate: r.session_date, amount: Number(r.amount), status: r.status },
    ])
  }

  const students: WellhubStudentRow[] = mems.map((m) => {
    const prof = profById.get(m.user_id)
    const target = m.monthly_checkin_target ?? 0
    const done = countDistinctDays(checkinsByStudent.get(m.user_id) ?? [])
    return {
      studentId: m.user_id,
      fullName: prof?.full_name ?? 'Aluno',
      phone: prof?.phone ?? null,
      partner: m.partner,
      // Meta 0 na membership cai no default da academia: sem isso a coluna de
      // progresso mostraria "3/0" para todo aluno que o admin ainda não configurou.
      progress: computeProgress(target > 0 ? target : defaultTarget, done),
      summary: summarizeMissedCheckins(openByStudent.get(m.user_id) ?? [], blockLimit),
      pendencies: pendenciesByStudent.get(m.user_id) ?? [],
    }
  })

  const lostAmount = students.reduce(
    (sum, s) =>
      sum +
      s.pendencies
        .filter((p) => p.status !== 'paid')
        .reduce((acc, p) => acc + Math.max(p.amount, 0), 0),
    0,
  )

  students.sort(
    (a, b) =>
      // Quem precisa de ação primeiro: bloqueado, depois quem tem mais pendência.
      Number(b.summary.blocked) - Number(a.summary.blocked) ||
      b.summary.openCount - a.summary.openCount ||
      a.fullName.localeCompare(b.fullName, 'pt-BR'),
  )

  return {
    blockLimit,
    price,
    students,
    totals: {
      partnerStudents: students.length,
      checkinDays: students.reduce((s, r) => s + r.progress.done, 0),
      openCount: students.reduce((s, r) => s + r.summary.openCount, 0),
      openAmount: students.reduce((s, r) => s + r.summary.openAmount, 0),
      lostAmount,
      blockedStudents: students.filter((s) => s.summary.blocked).length,
      belowTarget: students.filter((s) => s.progress.remaining > 0).length,
    },
  }
}
