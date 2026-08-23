// features/aulas/calendarFeedQuery.ts
// As aulas do aluno, prontas para virar eventos de calendário — a leitura por
// trás de app/api/calendar/[token]/route.ts.
//
// Mesma forma de features/home/arenaMonthQuery.ts getArenaMonth(), com duas
// diferenças: a janela é "de hoje em diante" (sem teto — o que existir gerado
// no banco, existe) em vez de um mês fechado, e só entra sessão 'scheduled'.
// Cancelada nunca aparece aqui de propósito: é assim que a assinatura de
// calendário "sincroniza sozinha" um cancelamento — o evento some da próxima
// vez que o app de calendário buscar o feed, sem nenhum código reagir à
// mutação em si.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import { resolveSession } from '@/lib/aulas/sessionOverride'
import { sessionStartIso } from '@/lib/utils/sessionTime'
import { brtToday } from '@/lib/utils/gridSchedule'
import { getApprovedVacations } from './vacationQueries'
import { isOnVacation } from '@/lib/aulas/vacation'
import type { CalendarEvent } from '@/lib/aulas/icsFeed'

type AdminClient = ReturnType<typeof createAdminClient>
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

interface ClassRef {
  name: string
  start_time: string
  end_time: string
  max_students: number
  court: number | null
}

interface SessionRow {
  id: string
  session_date: string
  class_id: string
  start_time: string | null
  end_time: string | null
  court: number | null
  classes: ClassRef | ClassRef[] | null
}

async function idsIn<T>(
  ids: string[],
  query: (part: string[]) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (const part of chunk(ids, IN_CHUNK_SIZE)) {
    const { data } = await query(part)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

/**
 * Todas as aulas futuras (`scheduled`) que são do aluno nesta academia —
 * fixas (matrícula ativa) ou avulsas (reserva confirmada) — já resolvidas
 * para hora/quadra reais, prontas para `buildIcsCalendar`.
 *
 * "É do aluno" segue a precedência de `mergeSessionAttendees`
 * (lib/utils/attendees.ts): reserva confirmada vence; na falta dela a matrícula
 * ativa conta, **a menos que** o aluno tenha avisado que não vem naquela data
 * (reserva `cancelled`) ou esteja de férias nela. Sem esses dois cortes o feed
 * mantinha no Google/Apple/Outlook uma aula que o app já tinha tirado da lista
 * de presentes — as duas fontes são parciais, e é a recusa que as corrige.
 */
export async function getCalendarFeedEvents(
  client: AdminClient,
  input: { orgId: string; studentId: string },
): Promise<CalendarEvent[]> {
  const { orgId, studentId } = input
  const today = brtToday(new Date())

  const [sessions, enrollments, vacations] = await Promise.all([
    fetchAllPages<SessionRow>(
      (a, b) =>
        client
          .from('class_sessions')
          .select(
            'id, session_date, class_id, start_time, end_time, court, classes(name, start_time, end_time, max_students, court)',
          )
          .eq('organization_id', orgId)
          .eq('status', 'scheduled')
          .gte('session_date', today)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<SessionRow>,
      { label: 'calendarFeed/sessoes' },
    ),
    fetchAllPages<{ class_id: string }>(
      (a, b) =>
        client
          .from('enrollments')
          .select('class_id')
          .eq('organization_id', orgId)
          .eq('student_id', studentId)
          .eq('is_active', true)
          .order('class_id', { ascending: true })
          .range(a, b) as unknown as Page<{ class_id: string }>,
      { label: 'calendarFeed/matriculas' },
    ),
    // Férias aprovadas que ainda alcançam o futuro. O aluno fixo de férias não
    // ganha reserva (a reconciliação nega com `on_vacation`), então não existe
    // linha `cancelled` para excluí-lo — sem esta leitura a aula seguiria no
    // calendário pessoal dele durante as férias.
    getApprovedVacations(client, studentId, orgId, today),
  ])

  const fixedClassIds = new Set(enrollments.map((e) => e.class_id))

  // Traz os DOIS status na mesma ida, sem filtro de status na query: o enum
  // `booking_status` só tem 'confirmed' e 'cancelled' (001_initial_schema.sql),
  // então não há terceiro caso a excluir — e uma query só custa o mesmo que a
  // anterior. A reserva `cancelled` é o opt-out do aluno fixo.
  const bookingRows = await idsIn(sessions.map((s) => s.id), (part) =>
    client
      .from('session_bookings')
      .select('session_id, status')
      .eq('student_id', studentId)
      .in('session_id', part) as unknown as PromiseLike<{
      data: { session_id: string; status: string }[] | null
    }>,
  )

  const myBookings = new Set(
    bookingRows.filter((r) => r.status !== 'cancelled').map((r) => r.session_id),
  )
  const myOptOuts = new Set(
    bookingRows.filter((r) => r.status === 'cancelled').map((r) => r.session_id),
  )

  const events: CalendarEvent[] = []

  for (const row of sessions) {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
    if (!cls) continue
    const temReserva = myBookings.has(row.id)
    const souFixo = fixedClassIds.has(row.class_id)
    // Reserva confirmada vence: quem confirmou entra, mesmo de férias.
    const recusouEstaData = myOptOuts.has(row.id) || isOnVacation(vacations, row.session_date)
    if (!temReserva && (!souFixo || recusouEstaData)) continue

    const resolved = resolveSession(row, cls)
    events.push({
      uid: row.id,
      title: cls.name,
      location: resolved.court !== null ? `Quadra ${resolved.court}` : null,
      startsAtIso: sessionStartIso(row.session_date, resolved.startTime),
      endsAtIso: sessionStartIso(row.session_date, resolved.endTime),
    })
  }

  return events
}
