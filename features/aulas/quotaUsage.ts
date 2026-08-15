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
import { canCancelWithRefund } from '@/lib/utils/creditRules'
import { sessionStartIso } from '@/lib/utils/sessionTime'

type AdminClient = ReturnType<typeof createAdminClient>

interface SessionJoin {
  session_date: string
  /** Override do horário naquela data; nulo herda a turma. */
  start_time: string | null
  classes: { start_time: string } | { start_time: string }[]
}

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
    .select(
      'status, cancelled_at, admin_waived, booked_at, class_sessions!inner(session_date, start_time, classes!inner(start_time))',
    )
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .gte('class_sessions.session_date', window.from)
    .lte('class_sessions.session_date', window.to)

  const bookings: QuotaBooking[] = (
    (bookingsRaw ?? []) as unknown as {
      status: string
      cancelled_at: string | null
      admin_waived: boolean | null
      booked_at: string | null
      class_sessions:
        | SessionJoin
        | SessionJoin[]
    }[]
  ).map((b) => {
    const sess = Array.isArray(b.class_sessions) ? b.class_sessions[0] : b.class_sessions
    const cls = Array.isArray(sess.classes) ? sess.classes[0] : sess.classes
    const confirmed = b.status === 'confirmed'

    // Horário DESTA data: a aula remarcada move a janela de cancelamento, e a
    // cota classifica "cancelou tarde" pela mesma janela que devolve o crédito.
    const startIso = sessionStartIso(sess.session_date, sess.start_time ?? cls.start_time)

    return {
      sessionDate: sess.session_date,
      status: confirmed ? ('confirmed' as const) : ('cancelled' as const),
      // A janela de arrependimento vale aqui também: quem entrou e saiu em
      // seguida não gastou aula do plano, então não pode consumir cota. Sem
      // passar `booked_at` a cota puniria justamente o cancelamento que o
      // estorno acabou de perdoar.
      cancelledLate:
        !confirmed && b.cancelled_at !== null
          ? !canCancelWithRefund(startIso, b.cancelled_at, undefined, b.booked_at)
          : false,
      adminWaived: b.admin_waived === true,
    }
  })

  const { data: enrollRaw } = await client
    .from('enrollments')
    .select('enrolled_at, classes!inner(day_of_week)')
    .eq('student_id', studentId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('enrolled_at', { ascending: true })

  // Só conta pro limite as matrículas mais antigas, até o que o plano ATUAL
  // permite. Se o aluno tem mais fixas do que classes_per_week hoje (o plano
  // foi reduzido depois de matriculado), as excedentes (mais novas) não
  // entram aqui — competem pela cota igual uma reserva avulsa.
  const fixedSessionsInCycle = (
    (enrollRaw ?? []) as unknown as {
      enrolled_at: string
      classes: { day_of_week: number } | { day_of_week: number }[]
    }[]
  )
    .slice(0, plan.classesPerWeek)
    .reduce((acc, e) => {
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
