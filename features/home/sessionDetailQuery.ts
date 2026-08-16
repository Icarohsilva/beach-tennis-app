// features/home/sessionDetailQuery.ts
// Monta a ficha da aula (AgendaSession) para um conjunto de sessões.
//
// Extraído da home porque agora existem DUAS portas para a mesma ficha: a faixa
// da semana, que já montava tudo isto, e o calendário do mês, que passou a abrir
// o mesmo modal em vez de mandar o aluno para outra tela. Duas montagens
// separadas divergiriam — uma ganharia a fila de espera, a outra não — e a ficha
// é exatamente o lugar onde faltar um dado significa um botão que mente.
import { createAdminClient } from '@/lib/supabase/server'
import { mergeSessionAttendees, type AttendeeRef } from '@/lib/utils/attendees'
import { getSelfCheckinViews } from '@/features/checkin/selfCheckinQueries'
import { listGuardianDependents } from '@/features/aulas/guardianQueries'
import { resolveSession, hasOverride } from '@/lib/aulas/sessionOverride'
import type { CheckinPartner } from '@/types'
import type { AgendaSession, GuardianOption } from './agendaTypes'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * A sessão como ela sai do banco, com a turma embutida e os overrides da data.
 *
 * As colunas soltas (`start_time`, `max_students`…) são o que aquela data
 * sobrescreve; `classes` é o padrão da turma. Quem resolve o par é
 * `resolveSession` — nunca leia `classes.start_time` direto aqui.
 */
export interface SessionRowWithClass {
  id: string
  session_date: string
  class_id: string
  /** 'scheduled' | 'cancelled' | 'completed'. Cancelada entra na agenda marcada. */
  status?: string
  cancelled_reason?: string | null
  start_time?: string | null
  end_time?: string | null
  court?: number | null
  max_students?: number | null
  classes:
    | ClassRef
    | ClassRef[]
    | null
}

interface ClassRef {
  name: string
  start_time: string
  end_time: string
  type: string
  sport: string | null
  max_students: number
  court?: number | null
}

function classOf(row: SessionRowWithClass): ClassRef | null {
  const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
  return (cls as ClassRef | null) ?? null
}

export interface BuildAgendaInput {
  orgId: string
  /** Usuário logado — "minha reserva" e "minha fila" são dele. */
  userId: string
  partner: CheckinPartner | null
  selfCheckinEnabled: boolean
  /** Turmas em que o usuário é aluno fixo. */
  enrolledClassIds: Set<string>
  rows: SessionRowWithClass[]
  /**
   * Saldo de crédito avulso do aluno. Junto com `hasPlanQuota` decide se a ficha
   * chega a perguntar como ele quer pagar.
   */
  creditsBalance: number
  /** Tem plano vigente com cota sobrando — o outro caminho de pagamento. */
  hasPlanQuota: boolean
}

/**
 * Ficha completa de cada sessão: quem vai, fila de espera, a reserva do aluno e
 * as linhas dos dependentes.
 *
 * Uma passada por assunto (reservas, matrículas, fila) sobre TODAS as sessões
 * pedidas, não uma consulta por sessão: a home pede sete dias de uma vez.
 */
export async function buildAgendaSessions(
  adminClient: AdminClient,
  input: BuildAgendaInput,
): Promise<AgendaSession[]> {
  const { orgId, userId, rows } = input
  const sessionIds = rows.map((r) => r.id)
  if (sessionIds.length === 0) return []

  // Só há escolha quando os dois caminhos existem. Com um só, perguntar seria
  // ruído — e para quem tem parceiro não existe escolha nenhuma: ele entra de
  // graça e gastar crédito seria jogar dinheiro fora.
  const canChoosePayment =
    input.partner === null && input.hasPlanQuota && input.creditsBalance >= 1

  // Dependentes primeiro: a ficha precisa saber, por sessão, o que cada filho já
  // tem ali (reserva, fila) para oferecer entrar ou sair no botão certo.
  const dependents = await listGuardianDependents()
  const dependentIds = new Set(dependents.map((d) => d.id))

  // Reservas da janela em confirmed E cancelled: a cancelada é o opt-out do
  // aluno fixo ("não venho nesta data") e precisa tirá-lo da lista de presentes.
  const { data: bookingsRaw } = await adminClient
    .from('session_bookings')
    .select('id, session_id, student_id, status, from_enrollment, profiles(full_name)')
    .in('session_id', sessionIds)
    .in('status', ['confirmed', 'cancelled'])

  type BookingRow = {
    id: string
    session_id: string
    student_id: string
    status: string
    from_enrollment: boolean
    profiles: { full_name: string } | { full_name: string }[] | null
  }

  const bookedBySession = new Map<string, AttendeeRef[]>()
  const optedOutBySession = new Map<string, Set<string>>()
  const myBookingBySession = new Map<string, { id: string; fromEnrollment: boolean }>()
  /** sessionId → (studentId do dependente → bookingId dele) */
  const depBookingBySession = new Map<string, Map<string, string>>()
  const bookedCount = new Map<string, number>()

  for (const b of (bookingsRaw ?? []) as unknown as BookingRow[]) {
    if (b.status === 'confirmed') {
      const p = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles
      bookedBySession.set(b.session_id, [
        ...(bookedBySession.get(b.session_id) ?? []),
        { id: b.student_id, name: p?.full_name ?? 'Aluno' },
      ])
      bookedCount.set(b.session_id, (bookedCount.get(b.session_id) ?? 0) + 1)
      if (b.student_id === userId) {
        myBookingBySession.set(b.session_id, { id: b.id, fromEnrollment: b.from_enrollment })
      } else if (dependentIds.has(b.student_id)) {
        const perSession = depBookingBySession.get(b.session_id) ?? new Map<string, string>()
        perSession.set(b.student_id, b.id)
        depBookingBySession.set(b.session_id, perSession)
      }
    } else if (b.status === 'cancelled') {
      const set = optedOutBySession.get(b.session_id) ?? new Set<string>()
      set.add(b.student_id)
      optedOutBySession.set(b.session_id, set)
    }
  }

  // Alunos fixos das turmas que aparecem na agenda.
  const rosterClassIds = Array.from(new Set(rows.map((r) => r.class_id)))
  const { data: rosterRaw } = rosterClassIds.length > 0
    ? await adminClient
        .from('enrollments')
        .select('class_id, student_id, profiles(full_name)')
        .in('class_id', rosterClassIds)
        .eq('is_active', true)
    : { data: [] }

  const enrolledByClass = new Map<string, AttendeeRef[]>()
  for (const e of (rosterRaw ?? []) as unknown as {
    class_id: string
    student_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    const p = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles
    enrolledByClass.set(e.class_id, [
      ...(enrolledByClass.get(e.class_id) ?? []),
      { id: e.student_id, name: p?.full_name ?? 'Aluno' },
    ])
  }

  // Fila de espera, em ordem de chegada. A ordem vem de joined_at (a coluna
  // `position` nunca é recalculada, então fica defasada).
  const { data: waitlistRaw } = await adminClient
    .from('waitlists')
    .select('id, session_id, student_id, joined_at, profiles(full_name)')
    .in('session_id', sessionIds)
    .in('status', ['waiting', 'offered'])
    .order('joined_at', { ascending: true })

  const waitlistBySession = new Map<string, string[]>()
  const myWaitlistBySession = new Map<string, string>()
  /** sessionId → (studentId do dependente → id da entrada dele na fila) */
  const depWaitlistBySession = new Map<string, Map<string, string>>()

  for (const w of (waitlistRaw ?? []) as unknown as {
    id: string
    session_id: string
    student_id: string
    profiles: { full_name: string } | { full_name: string }[] | null
  }[]) {
    const p = Array.isArray(w.profiles) ? w.profiles[0] : w.profiles
    waitlistBySession.set(w.session_id, [
      ...(waitlistBySession.get(w.session_id) ?? []),
      p?.full_name ?? 'Aluno',
    ])
    if (w.student_id === userId) {
      myWaitlistBySession.set(w.session_id, w.id)
    } else if (dependentIds.has(w.student_id)) {
      const perSession = depWaitlistBySession.get(w.session_id) ?? new Map<string, string>()
      perSession.set(w.student_id, w.id)
      depWaitlistBySession.set(w.session_id, perSession)
    }
  }

  // Confirmação de presença pelo app: só as aulas do próprio aluno interessam.
  const myRefs = rows
    .filter((r) => {
      // Aula cancelada não tem presença a confirmar.
      if (r.status === 'cancelled') return false
      if (myBookingBySession.has(r.id)) return true
      // Fixo sem reserva conta, a menos que tenha avisado que não vem — mesma
      // regra de isStudentExpectedInSession, que a action reaplica.
      if (!input.enrolledClassIds.has(r.class_id)) return false
      return !optedOutBySession.get(r.id)?.has(userId)
    })
    .map((r) => {
      const cls = classOf(r)
      if (!cls) return null
      const { startTime, endTime } = resolveSession(r, cls)
      return { id: r.id, date: r.session_date, start: startTime, end: endTime }
    })
    .filter((s): s is { id: string; date: string; start: string; end: string } => s !== null)

  const selfCheckinViews = await getSelfCheckinViews(adminClient, {
    orgId,
    studentId: userId,
    partner: input.partner,
    sessions: myRefs,
    enabled: input.selfCheckinEnabled,
  })

  /** Quem é esperado numa sessão: reservas confirmadas + fixos que não recusaram. */
  function attendeesOf(sessionId: string, classId: string): string[] {
    return mergeSessionAttendees({
      booked: bookedBySession.get(sessionId) ?? [],
      enrolled: enrolledByClass.get(classId) ?? [],
      optedOut: optedOutBySession.get(sessionId) ?? new Set<string>(),
    }).map((a) => a.name)
  }

  return rows
    .map((row): AgendaSession | null => {
      const cls = classOf(row)
      if (!cls) return null
      // Horário e capacidade DESTA data, não os da turma: a aula remarcada tem
      // de aparecer no horário novo em toda a agenda, não só na tela do admin.
      const resolved = resolveSession(row, cls)
      const myBooking = myBookingBySession.get(row.id)
      const depBookings = depBookingBySession.get(row.id)
      const depWaitlist = depWaitlistBySession.get(row.id)

      const guardianOptions: GuardianOption[] = dependents.map((d) => ({
        id: d.id,
        name: d.name,
        bookingId: depBookings?.get(d.id),
        waitlistEntryId: depWaitlist?.get(d.id),
      }))

      return {
        id: row.id,
        date: row.session_date,
        className: cls.name,
        start: resolved.startTime,
        end: resolved.endTime,
        booked: bookedCount.get(row.id) ?? 0,
        capacity: resolved.maxStudents,
        mine: !!myBooking,
        fixed: input.enrolledClassIds.has(row.class_id),
        kids: cls.type === 'kids',
        sport: cls.sport ?? null,
        attendees: attendeesOf(row.id, row.class_id),
        waitlist: waitlistBySession.get(row.id) ?? [],
        waitlistEntryId: myWaitlistBySession.get(row.id),
        bookingId: myBooking?.id,
        fromEnrollment: myBooking?.fromEnrollment,
        selfCheckin: selfCheckinViews.get(row.id),
        guardianOptions: guardianOptions.length > 0 ? guardianOptions : undefined,
        rescheduled: hasOverride(row) || undefined,
        cancelled: row.status === 'cancelled' || undefined,
        cancelledReason: row.status === 'cancelled' ? (row.cancelled_reason ?? null) : undefined,
        canChoosePayment: canChoosePayment || undefined,
        creditsBalance: input.creditsBalance,
      }
    })
    .filter((s): s is AgendaSession => s !== null)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
}
