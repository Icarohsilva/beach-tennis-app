import { eachDayOfInterval, getDay, format, parseISO } from 'date-fns'
import type { createAdminClient } from '@/lib/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

/** Pure helper — returns session rows to insert for a class */
export function buildSessionRows(
  classId: string,
  dayOfWeek: number,
  fromDateStr: string,
  toDateStr: string,
): Array<{ class_id: string; session_date: string; status: string; notes: null }> {
  const from = parseISO(fromDateStr)
  const to = parseISO(toDateStr)
  return eachDayOfInterval({ start: from, end: to })
    .filter((d) => getDay(d) === dayOfWeek)
    .map((d) => ({
      class_id: classId,
      session_date: format(d, 'yyyy-MM-dd'),
      status: 'scheduled',
      notes: null,
    }))
}

/**
 * O aluno é esperado nesta sessão?
 *
 * Mesma regra que monta a lista da chamada e a agenda do aluno — enunciada em
 * `mergeSessionAttendees` (lib/utils/attendees.ts): reserva `confirmed` vence;
 * na falta dela, matrícula fixa ativa na turma conta, a menos que o aluno tenha
 * avisado que não vem (reserva `cancelled` nesta sessão).
 *
 * Existe porque a confirmação de presença pelo app precisa do mesmo veredito
 * para UM aluno, enquanto a chamada precisa da lista inteira.
 */
export async function isStudentExpectedInSession(
  client: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string; classId: string },
): Promise<boolean> {
  const { orgId, studentId, sessionId, classId } = input

  const { data: booking } = await client
    .from('session_bookings')
    .select('status')
    .eq('organization_id', orgId)
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle()

  const status = (booking as { status: string } | null)?.status
  if (status === 'confirmed') return true
  if (status === 'cancelled') return false

  const { data: enrollment } = await client
    .from('enrollments')
    .select('id')
    .eq('organization_id', orgId)
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .eq('is_active', true)
    .maybeSingle()

  return !!enrollment
}

/**
 * Todos os alunos esperados numa sessão, de uma vez.
 *
 * Mesma regra de `isStudentExpectedInSession`, no plural, e pelo mesmo motivo de
 * `mergeSessionAttendees` existir: as duas fontes são PARCIAIS. O aluno fixo só
 * ganha linha em `session_bookings` quando a reconciliação roda e ele está
 * elegível, então uma turma convive normalmente com fixos sem reserva.
 *
 * Avisar de aula cancelada olhando só `session_bookings` deixava justamente esse
 * aluno de fora — ele é esperado na quadra e não recebia nada.
 */
export async function expectedStudentIds(
  client: AdminClient,
  input: { orgId: string; sessionId: string; classId: string },
): Promise<string[]> {
  const { orgId, sessionId, classId } = input

  const [{ data: bookingsRaw }, { data: enrollRaw }] = await Promise.all([
    client
      .from('session_bookings')
      .select('student_id, status')
      .eq('organization_id', orgId)
      .eq('session_id', sessionId)
      .in('status', ['confirmed', 'cancelled']),
    client
      .from('enrollments')
      .select('student_id')
      .eq('organization_id', orgId)
      .eq('class_id', classId)
      .eq('is_active', true),
  ])

  const bookings = (bookingsRaw ?? []) as { student_id: string; status: string }[]

  const confirmed = new Set<string>()
  const optedOut = new Set<string>()
  for (const b of bookings) {
    if (b.status === 'confirmed') confirmed.add(b.student_id)
    else optedOut.add(b.student_id)
  }

  const ids = new Set(confirmed)
  for (const e of (enrollRaw ?? []) as { student_id: string }[]) {
    // Reserva confirmada vence o opt-out (mesma precedência de mergeSessionAttendees).
    if (confirmed.has(e.student_id) || optedOut.has(e.student_id)) continue
    ids.add(e.student_id)
  }

  return Array.from(ids)
}

/**
 * O aluno fixo saiu DESTA data e pode voltar?
 *
 * Devolve `null` quando não é esse caso (não é fixo da turma, ou não há saída
 * registrada nesta sessão). Quando é, devolve a reserva cancelada que marca a
 * saída — `creditRefunded` diz se aquela aula tinha sido paga com crédito, e
 * portanto se a saída gerou crédito de reposição (`skipEnrollmentSession`).
 *
 * Existe porque a vaga da aula fixa continua sendo do aluno: voltar não é
 * comprar aula nova, e precificar como avulsa cobraria duas vezes a mesma vaga.
 * Quem decide o que fazer com o crédito é `resolveEnrollmentRejoin`
 * (lib/utils/accessRules.ts) — aqui só se lê o banco.
 */
export async function findEnrollmentRejoin(
  client: AdminClient,
  input: { orgId: string; studentId: string; sessionId: string; classId: string },
): Promise<{ bookingId: string; creditRefunded: boolean } | null> {
  const { orgId, studentId, sessionId, classId } = input

  const { data: booking } = await client
    .from('session_bookings')
    .select('id, status, from_enrollment, credit_used')
    .eq('organization_id', orgId)
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle()

  const row = booking as
    | { id: string; status: string; from_enrollment: boolean; credit_used: boolean }
    | null

  // Só a saída de aula FIXA dá direito à volta de graça. Reserva avulsa
  // cancelada é outra história: aquela vaga não era dele por matrícula.
  if (!row || row.status !== 'cancelled' || !row.from_enrollment) return null

  const { data: enrollment } = await client
    .from('enrollments')
    .select('id')
    .eq('organization_id', orgId)
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .eq('is_active', true)
    .maybeSingle()

  // Matrícula encerrada depois da saída: a vaga não é mais dele, então a volta
  // é uma aula avulsa como qualquer outra.
  if (!enrollment) return null

  return { bookingId: row.id, creditRefunded: row.credit_used === true }
}
