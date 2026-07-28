// I/O da cota: busca no banco o que lib/utils/classQuota (puro) precisa.
import type { createAdminClient } from '@/lib/supabase/server'
import {
  cycleWindow,
  countCycleWeeks,
  resolveQuota,
  countOnDate,
  type PlanQuota,
  type QuotaBooking,
} from '@/lib/utils/classQuota'
import { addDaysStr } from '@/lib/utils/gridSchedule'

type AdminClient = ReturnType<typeof createAdminClient>

export interface QuotaSnapshot {
  limit: number
  used: number
  remaining: number
  /** Reservas confirmadas do aluno na data pedida — insumo do teto diário. */
  bookingsOnDate: number
  /** Janela do ciclo, para exibir na UI ("neste mês" / "nesta semana"). */
  window: { from: string; to: string }
}

/** Quantas vezes `dayOfWeek` (0=domingo) ocorre em [from, to]. */
function occurrencesOfDay(from: string, to: string, dayOfWeek: number): number {
  let count = 0
  let cursor = from
  while (cursor <= to) {
    const [y, m, d] = cursor.split('-').map(Number)
    if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dayOfWeek) count++
    cursor = addDaysStr(cursor, 1)
  }
  return count
}

export async function getQuotaSnapshot(
  client: AdminClient,
  studentId: string,
  orgId: string,
  plan: PlanQuota,
  targetDate: string,
): Promise<QuotaSnapshot> {
  const window = cycleWindow(targetDate, plan.cycle)

  const { data: bookingsRaw } = await client
    .from('session_bookings')
    .select('status, cancelled_at, class_sessions!inner(session_date)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('class_sessions.session_date', window.from)
    .lte('class_sessions.session_date', window.to)

  const bookings: QuotaBooking[] = (
    (bookingsRaw ?? []) as unknown as {
      status: string
      cancelled_at: string | null
      class_sessions: { session_date: string } | { session_date: string }[]
    }[]
  ).map((b) => {
    const sess = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions
    return {
      sessionDate: sess.session_date,
      status: b.status === 'confirmed' ? 'confirmed' : 'cancelled',
      // cancelledLate só muda o resultado quando o plano NÃO reembolsa; nos
      // demais casos resolveQuota descarta a cancelada de qualquer jeito.
      // Determinar "tarde" exige o horário da turma, então só pagamos esse
      // custo quando importa — ver a nota abaixo.
      cancelledLate: false,
    }
  })

  const { data: enrollRaw } = await client
    .from('enrollments')
    .select('classes!inner(day_of_week)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const fixedSessionsInCycle = (
    (enrollRaw ?? []) as unknown as {
      classes: { day_of_week: number } | { day_of_week: number }[]
    }[]
  ).reduce((acc, e) => {
    const cls = Array.isArray(e.classes) ? e.classes[0] : e.classes
    return acc + occurrencesOfDay(window.from, window.to, cls.day_of_week)
  }, 0)

  const quota = resolveQuota({
    plan,
    cycleWeeks: countCycleWeeks(window.from, window.to),
    bookings,
    fixedSessionsInCycle,
  })

  return {
    ...quota,
    bookingsOnDate: countOnDate(bookings, targetDate),
    window,
  }
}
