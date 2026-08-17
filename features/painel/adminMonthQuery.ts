// features/painel/adminMonthQuery.ts
// O mês da academia como o admin precisa ver: com ocupação, com rascunho, com
// aula cancelada e com o que ainda não saiu do molde.
//
// É a mesma janela do calendário do aluno, mas o recorte é o oposto: o aluno vê
// o que pode fazer, o admin vê o que existe. Torneio em rascunho, sessão
// cancelada e turma sem sessão gerada são justamente o que ele precisa achar.
import { createAdminClient } from '@/lib/supabase/server'
import { IN_CHUNK_SIZE, chunk, fetchAllPages } from '@/lib/supabase/paginate'
import { gridBounds, sortArenaEvents, type ArenaEvent } from '@/lib/home/arenaAgenda'
import {
  summarizeGeneration,
  type ActiveClass,
  type DayGeneration,
} from '@/lib/painel/gradeStatus'
import { formatTime } from '@/lib/utils/dateHelpers'
import { sportChip } from '@/lib/torneios/sportProfile'
import { resolveSession, hasOverride } from '@/lib/aulas/sessionOverride'

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** O evento da agenda com o que só o painel usa. */
export interface AdminEvent extends ArenaEvent {
  /** Selo de estado quando ele muda o que o admin deve fazer. */
  flag: 'cancelada' | 'rascunho' | 'alterada' | null
}

export interface AdminMonth {
  events: AdminEvent[]
  /** Retrato de geração por data — o "gerei / não gerei" da grade. */
  generation: Record<string, DayGeneration>
}

interface Args {
  orgId: string
  /** 'YYYY-MM' */
  monthISO: string
  /** Hoje, para não acusar pendência de geração no passado. */
  todayISO: string
}

export async function getAdminMonth({ orgId, monthISO, todayISO }: Args): Promise<AdminMonth> {
  const admin = createAdminClient()
  const { from, to } = gridBounds(monthISO)

  const [sessions, tournaments, dayUse, classes] = await Promise.all([
    fetchAllPages<SessionRow>(
      (a, b) =>
        admin
          .from('class_sessions')
          .select(
            'id, session_date, class_id, status, start_time, end_time, court, max_students, classes(name, start_time, end_time, type, sport, max_students, court)',
          )
          .eq('organization_id', orgId)
          .gte('session_date', from)
          .lte('session_date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<SessionRow>,
      { label: 'painel/mes-aulas' },
    ),
    fetchAllPages<TournamentRow>(
      (a, b) =>
        admin
          .from('tournaments')
          .select('id, name, date, sport, status')
          .eq('organization_id', orgId)
          .gte('date', from)
          .lte('date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<TournamentRow>,
      { label: 'painel/mes-torneios' },
    ),
    fetchAllPages<DayUseRow>(
      (a, b) =>
        admin
          .from('dayuse_slots')
          .select('id, date, start_time, end_time, court, capacity, notes, is_active')
          .eq('organization_id', orgId)
          .gte('date', from)
          .lte('date', to)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<DayUseRow>,
      { label: 'painel/mes-dayuse' },
    ),
    fetchAllPages<ClassRow>(
      (a, b) =>
        admin
          .from('classes')
          .select('id, day_of_week')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Page<ClassRow>,
      { label: 'painel/mes-turmas' },
    ),
  ])

  // Ocupação de cada sessão: é a informação que o admin abre o calendário para
  // ver ("a de sábado está vazia de novo?").
  const bookedBySession = await countBookings(sessions.map((s) => s.id))
  const entrantsByTournament = await countEntries(tournaments.map((t) => t.id))
  const dayUseBySlot = await countDayUse(dayUse.map((d) => d.id))

  const events: AdminEvent[] = []

  for (const row of sessions) {
    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes
    if (!cls) continue
    const cancelled = row.status === 'cancelled'
    // Horário e capacidade DESTA data (lib/aulas/sessionOverride).
    const horario = resolveSession(row, cls)
    events.push({
      id: row.id,
      kind: 'aula',
      date: row.session_date,
      start: horario.startTime,
      end: horario.endTime,
      title: cls.name,
      subtitle: cls.sport ? sportChip(cls.sport).label : null,
      sport: cls.sport,
      // `mine` no painel quer dizer "precisa de olho": aula cancelada é o que o
      // admin procura quando abre o dia.
      mine: cancelled,
      // Só "ver": a ficha da aula é onde se edita a data, cancela e reabre. O
      // botão "Editar" que existia aqui montava /admin/grade/<sessionId>/editar
      // e caía em 404 — aquela rota espera um id de TURMA, não de sessão.
      href: `/admin/grade/${row.id}`,
      flag: cancelled ? 'cancelada' : hasOverride(row) ? 'alterada' : null,
      booked: bookedBySession.get(row.id) ?? 0,
      capacity: horario.maxStudents,
    })
  }

  for (const t of tournaments) {
    events.push({
      id: t.id,
      kind: 'torneio',
      date: t.date,
      start: null,
      end: null,
      title: t.name,
      subtitle: sportChip(t.sport).label,
      sport: t.sport,
      mine: t.status === 'draft',
      href: `/admin/torneios/${t.id}`,
      flag: t.status === 'draft' ? 'rascunho' : null,
      booked: entrantsByTournament.get(t.id) ?? 0,
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
      title: `Quadra ${d.court}`,
      subtitle: d.notes?.trim() || `${formatTime(d.start_time)} às ${formatTime(d.end_time)}`,
      sport: null,
      mine: !d.is_active,
      href: '/admin/grade/dayuse',
      flag: d.is_active ? null : 'cancelada',
      booked: dayUseBySlot.get(d.id) ?? 0,
      capacity: d.capacity,
    })
  }

  // Que datas a grade exibe — a mesma janela das consultas acima.
  const dates: string[] = []
  for (let d = from; d <= to; d = nextDay(d)) dates.push(d)

  // Sessão CANCELADA não conta como gerada: a geração hoje a reabre, então a
  // data ainda tem trabalho pendente e o botão "Gerar aulas deste dia" precisa
  // aparecer. Antes ela contava, e o calendário dizia "nada a fazer" justamente
  // na data que o admin queria reconstruir.
  const byDate = new Map<string, Set<string>>()
  for (const s of sessions) {
    if (s.status === 'cancelled') continue
    const set = byDate.get(s.session_date) ?? new Set<string>()
    set.add(s.class_id)
    byDate.set(s.session_date, set)
  }

  const activeClasses: ActiveClass[] = classes.map((c) => ({ id: c.id, dayOfWeek: c.day_of_week }))
  const generation = summarizeGeneration(activeClasses, byDate, dates, todayISO)

  return {
    events: sortArenaEvents(events),
    generation: Object.fromEntries(generation),
  }
}

function nextDay(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Ocupação das aulas do mês.
 *
 * Uma consulta por lote trazendo só a coluna de agrupamento, com a soma no
 * Node: um `count: exact` por sessão seriam centenas de idas ao banco para
 * montar um calendário.
 */
async function countBookings(sessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (sessionIds.length === 0) return out
  const admin = createAdminClient()

  for (const part of chunk(sessionIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ session_id: string }>(
      (a, b) =>
        admin
          .from('session_bookings')
          .select('session_id')
          .eq('status', 'confirmed')
          .in('session_id', part)
          .order('session_id', { ascending: true })
          .range(a, b) as unknown as Page<{ session_id: string }>,
      { label: 'painel/contagem-reservas' },
    )
    for (const r of rows) out.set(r.session_id, (out.get(r.session_id) ?? 0) + 1)
  }
  return out
}

/** Inscritos por torneio — `confirmed` + `offered`, igual ao availableSlots. */
async function countEntries(tournamentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (tournamentIds.length === 0) return out
  const admin = createAdminClient()

  for (const part of chunk(tournamentIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ tournament_id: string }>(
      (a, b) =>
        admin
          .from('tournament_entries')
          .select('tournament_id')
          .in('entry_status', ['confirmed', 'offered'])
          .in('tournament_id', part)
          .order('tournament_id', { ascending: true })
          .range(a, b) as unknown as Page<{ tournament_id: string }>,
      { label: 'painel/contagem-inscricoes' },
    )
    for (const r of rows) out.set(r.tournament_id, (out.get(r.tournament_id) ?? 0) + 1)
  }
  return out
}

async function countDayUse(slotIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (slotIds.length === 0) return out
  const admin = createAdminClient()

  for (const part of chunk(slotIds, IN_CHUNK_SIZE)) {
    const rows = await fetchAllPages<{ slot_id: string }>(
      (a, b) =>
        admin
          .from('dayuse_bookings')
          .select('slot_id')
          .eq('status', 'confirmed')
          .in('slot_id', part)
          .order('slot_id', { ascending: true })
          .range(a, b) as unknown as Page<{ slot_id: string }>,
      { label: 'painel/contagem-dayuse' },
    )
    for (const r of rows) out.set(r.slot_id, (out.get(r.slot_id) ?? 0) + 1)
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
  status: string
  /** Overrides daquela data; nulos herdam a turma (lib/aulas/sessionOverride). */
  start_time: string | null
  end_time: string | null
  court: number | null
  max_students: number | null
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
  capacity: number
  notes: string | null
  is_active: boolean
}

interface ClassRow {
  id: string
  day_of_week: number
}
