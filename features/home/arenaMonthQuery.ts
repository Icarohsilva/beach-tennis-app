// features/home/arenaMonthQuery.ts
// A agenda da arena numa janela de datas: aula, torneio e day use na mesma lista.
//
// É a leitura mais larga da home (uma academia inteira × ~5 semanas), então
// passa por fetchAllPages: academia com 40 turmas estoura as 1.000 linhas do
// PostgREST em pouco mais de um mês, e o corte volta com `error: null` — o
// calendário simplesmente perderia os últimos dias sem avisar ninguém.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import { gridBounds, sortArenaEvents, type ArenaEvent } from '@/lib/home/arenaAgenda'
import { formatTime } from '@/lib/utils/dateHelpers'
import { sportChip } from '@/lib/torneios/sportProfile'

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

interface WindowArgs {
  orgId: string
  userId: string
  /** 'YYYY-MM-DD' */
  from: string
  to: string
}

/**
 * Torneio e day use da janela, já marcando o que é do aluno.
 *
 * Separado das aulas porque a faixa da semana precisa só disto (as aulas dela
 * vêm com ocupação e lista de presentes, que o calendário do mês não carrega).
 */
export async function getArenaExtras({
  orgId,
  userId,
  from,
  to,
}: WindowArgs): Promise<ArenaEvent[]> {
  const admin = createAdminClient()

  const [tournaments, dayUse] = await Promise.all([
    fetchAllPages<TournamentRow>(
      (a, b) =>
        admin
          .from('tournaments')
          .select('id, name, date, sport, status')
          .eq('organization_id', orgId)
          .neq('status', 'draft')
          .gte('date', from)
          .lte('date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<TournamentRow>,
      { label: 'home/agenda-torneios' },
    ),
    fetchAllPages<DayUseRow>(
      (a, b) =>
        admin
          .from('dayuse_slots')
          .select('id, date, start_time, end_time, court, notes')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .gte('date', from)
          .lte('date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<DayUseRow>,
      { label: 'home/agenda-dayuse' },
    ),
  ])

  const [myEntries, myDayUse] = await Promise.all([
    idsIn(tournaments.map((t) => t.id), (part) =>
      admin
        .from('tournament_entries')
        .select('tournament_id')
        .or(`player_id.eq.${userId},partner_id.eq.${userId}`)
        .in('tournament_id', part) as unknown as PromiseLike<{
        data: { tournament_id: string }[] | null
      }>,
    ).then((rows) => new Set(rows.map((r) => r.tournament_id))),
    idsIn(dayUse.map((d) => d.id), (part) =>
      admin
        .from('dayuse_bookings')
        .select('slot_id')
        .eq('student_id', userId)
        .eq('status', 'confirmed')
        .in('slot_id', part) as unknown as PromiseLike<{ data: { slot_id: string }[] | null }>,
    ).then((rows) => new Set(rows.map((r) => r.slot_id))),
  ])

  const events: ArenaEvent[] = []

  for (const t of tournaments) {
    events.push({
      id: t.id,
      kind: 'torneio',
      date: t.date,
      // Torneio não tem hora no modelo — o dia é o compromisso.
      start: null,
      end: null,
      title: t.name,
      subtitle: sportChip(t.sport).label,
      sport: t.sport,
      mine: myEntries.has(t.id),
      href: `/torneios/${t.id}`,
      booked: null,
      capacity: null,
    })
  }

  for (const d of dayUse) {
    events.push({
      id: d.id,
      kind: 'dayuse',
      date: d.date,
      start: d.start_time,
      end: d.end_time,
      // Só a quadra: a pastilha ao lado já diz "Day use", e repetir consumia a
      // largura do celular até o nome virar "Day use · Qua…".
      title: `Quadra ${d.court}`,
      subtitle: d.notes?.trim() || `${formatTime(d.start_time)} às ${formatTime(d.end_time)}`,
      sport: null,
      mine: myDayUse.has(d.id),
      href: '/agendar/dayuse',
      booked: null,
      capacity: null,
    })
  }

  return sortArenaEvents(events)
}

interface MonthArgs {
  orgId: string
  userId: string
  /** 'YYYY-MM' */
  monthISO: string
  /** Aluno vê turma kids? Só dependente vê — mesma regra da agenda da semana. */
  includeKids: boolean
}

/** Tudo que acontece na arena na janela que o calendário do mês exibe. */
export async function getArenaMonth({
  orgId,
  userId,
  monthISO,
  includeKids,
}: MonthArgs): Promise<ArenaEvent[]> {
  const admin = createAdminClient()
  const { from, to } = gridBounds(monthISO)

  const [sessions, enrollments, extras] = await Promise.all([
    fetchAllPages<SessionRow>(
      (a, b) =>
        admin
          .from('class_sessions')
          .select('id, session_date, class_id, classes(name, start_time, end_time, type, sport, max_students)')
          .eq('organization_id', orgId)
          .eq('status', 'scheduled')
          .gte('session_date', from)
          .lte('session_date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<SessionRow>,
      { label: 'home/mes-aulas' },
    ),
    fetchAllPages<{ class_id: string }>(
      (a, b) =>
        admin
          .from('enrollments')
          .select('class_id')
          .eq('organization_id', orgId)
          .eq('student_id', userId)
          .eq('is_active', true)
          .order('class_id', { ascending: true })
          .range(a, b) as unknown as Page<{ class_id: string }>,
      { label: 'home/mes-matriculas' },
    ),
    getArenaExtras({ orgId, userId, from, to }),
  ])

  const fixedClassIds = new Set(enrollments.map((e) => e.class_id))

  // Reserva confirmada do aluno na janela. Sem isto o calendário mostra a
  // arena, não a vida dele — e a cor de "meu dia" nunca acende.
  const myBookings = await idsIn(sessions.map((s) => s.id), (part) =>
    admin
      .from('session_bookings')
      .select('session_id')
      .eq('student_id', userId)
      .eq('status', 'confirmed')
      .in('session_id', part) as unknown as PromiseLike<{
      data: { session_id: string }[] | null
    }>,
  ).then((rows) => new Set(rows.map((r) => r.session_id)))

  const events: ArenaEvent[] = [...extras]

  for (const row of sessions) {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
    if (!cls) continue
    if (cls.type === 'kids' && !includeKids) continue
    events.push({
      id: row.id,
      kind: 'aula',
      date: row.session_date,
      start: cls.start_time,
      end: cls.end_time,
      title: cls.name,
      subtitle: cls.sport ? sportChip(cls.sport).label : null,
      sport: cls.sport,
      mine: myBookings.has(row.id) || fixedClassIds.has(row.class_id),
      href: '/agendar',
      booked: null,
      capacity: cls.max_students,
    })
  }

  return sortArenaEvents(events)
}

/** `.in()` em lote — a lista de ids viaja na URL e estoura o limite dela. */
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

type ClassRef = {
  name: string
  start_time: string
  end_time: string
  type: string
  sport: string | null
  max_students: number
}

interface SessionRow {
  id: string
  session_date: string
  class_id: string
  classes: ClassRef | ClassRef[] | null
}

interface TournamentRow {
  id: string
  name: string
  date: string
  sport: string
  status: string
}

interface DayUseRow {
  id: string
  date: string
  start_time: string
  end_time: string
  court: number
  notes: string | null
}
