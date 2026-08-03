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
