// app/(admin)/grade/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { getClassRoster } from '@/features/aulas/enrollmentRoster'
import { GenerateWeekButton, GenerateDayButton } from './GridGenerateButtons'
import { DeleteClassButton } from './DeleteClassButton'
import { CalendarDays } from 'lucide-react'
import type { Class, ClassSession } from '@/types'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { brtToday } from '@/lib/utils/gridSchedule'
import { resolveSession, hasOverride } from '@/lib/aulas/sessionOverride'

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'há minutos'
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

export default async function GradePage() {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  // Fetch all active classes
  const { data: classes } = await adminClient
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (classes ?? []) as Class[]

  // Fetch today's sessions
  const today = brtToday(new Date()) // BRT: em servidor UTC o "hoje" cru virava amanhã depois das 21h
  const { data: todaySessions } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(name, level, type, start_time, end_time, max_students)')
    .eq('session_date', today)
    .neq('status', 'cancelled')
    .eq('organization_id', orgId)
    .order('class(start_time)', { ascending: true })

  type SessionWithClass = ClassSession & {
    class: { name: string; level: string; type: string; start_time: string; end_time: string; max_students: number }
  }
  const sessionsToday = (todaySessions ?? []) as SessionWithClass[]

  // Fetch booking counts for today sessions
  const sessionIds = sessionsToday.map((s) => s.id)
  const { data: bookingCountsRaw } =
    sessionIds.length > 0
      ? await adminClient
          .from('session_bookings')
          .select('session_id')
          .in('session_id', sessionIds)
          .eq('organization_id', orgId)
          .eq('status', 'confirmed')
      : { data: [] }

  const bookingCountMap = new Map<string, number>()
  for (const b of (bookingCountsRaw ?? []) as { session_id: string }[]) {
    bookingCountMap.set(b.session_id, (bookingCountMap.get(b.session_id) ?? 0) + 1)
  }

  // Group active classes by day_of_week
  const classesByDay = new Map<number, Class[]>()
  for (const c of allClasses) {
    const arr = classesByDay.get(c.day_of_week) ?? []
    arr.push(c)
    classesByDay.set(c.day_of_week, arr)
  }

  // Roster (matriculados/elegíveis/a-confirmar/sem-plano) via getClassRoster —
  // org-wide, sem filtro de dia/turma (esta página mostra a semana toda).
  const classIds = allClasses.map((c) => c.id)
  const roster = await getClassRoster(adminClient, orgId!)

  // Info de geração por turma: maior session_date e created_at correspondente
  // (status scheduled). organization_id explícito por defesa em profundidade,
  // mesmo padrão do resto deste arquivo (linha 41 já faz isso pra sessionsToday).
  const { data: genRaw } = classIds.length > 0
    ? await adminClient
        .from('class_sessions')
        .select('class_id, session_date, created_at')
        .in('class_id', classIds)
        .eq('organization_id', orgId)
        .eq('status', 'scheduled')
        .gte('session_date', today)
    : { data: [] }
  const genByClass = new Map<string, { lastDate: string; lastCreated: string }>()
  for (const s of (genRaw ?? []) as { class_id: string; session_date: string; created_at: string }[]) {
    const cur = genByClass.get(s.class_id)
    if (!cur || s.session_date > cur.lastDate) {
      genByClass.set(s.class_id, { lastDate: s.session_date, lastCreated: s.created_at })
    }
  }

  const dayNumber = new Date().getDay() // 0=Sunday

  return (
    <div className="space-y-6">
      {/* flex-wrap: era o único header do admin sem ele. Os três botões somavam
          ~316px contra 272px de conteúdo em 320px, e deformavam encostados no h1.
          Mesmo padrão de /admin/torneios. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold text-white">Grade de Aulas</h1>
        <div className="flex flex-wrap items-center gap-2">
          <GenerateWeekButton />
          <Link href="/admin/grade/dayuse">
            <Button variant="secondary" size="sm">Day Use</Button>
          </Link>
          <Link href="/admin/grade/nova-turma">
            <Button size="sm">+ Nova Turma</Button>
          </Link>
        </div>
      </div>

      {/* Today's sessions */}
      <section>
        <SectionHeader title={`Hoje · ${DAY_NAMES[dayNumber]}`} />
        {sessionsToday.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nenhuma sessão hoje." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessionsToday.map((session) => {
              const confirmed = bookingCountMap.get(session.id) ?? 0
              const clsRaw = Array.isArray(session.class) ? session.class[0] : session.class
              // Horário e capacidade DESTA data: a aula remarcada tem de sair
              // remarcada também na grade de hoje do professor.
              const horario = resolveSession(session, clsRaw)
              const max = horario.maxStudents
              const isFull = confirmed >= max

              return (
                <Link key={session.id} href={`/admin/grade/${session.id}`}>
                  <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-white font-semibold text-sm">{clsRaw.name}</span>
                      {clsRaw.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      {formatTime(horario.startTime)} – {formatTime(horario.endTime)}
                      {hasOverride(session) && (
                        <span className="ml-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                          alterada
                        </span>
                      )}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-sm font-extrabold text-brand-500">{confirmed}/{max}</span>
                      {isFull ? (
                        <Badge variant="danger">Lotada</Badge>
                      ) : (
                        <Badge variant="success">Disponível</Badge>
                      )}
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Weekly schedule */}
      <section>
        <SectionHeader title="Grade Semanal" />
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const dayClasses = classesByDay.get(day) ?? []
          if (dayClasses.length === 0) return null
          return (
            <div key={day} className="mb-4">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center justify-between">
                <span>{DAY_ABBR[day]}</span>
                <GenerateDayButton dayOfWeek={day} />
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dayClasses.map((c) => {
                  const rc = roster.byClass.get(c.id) ?? { enrolled: 0, eligible: 0, pendingConfirmation: 0, noPlan: 0, students: [] }
                  const gen = genByClass.get(c.id)
                  return (
                    <Card key={c.id}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-white text-sm font-medium truncate">{c.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                          <Link href={`/admin/grade/${c.id}/editar`} className="text-xs text-slate-400 hover:text-brand-500 ml-1">Editar</Link>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mb-1">
                        {/* nowrap: divide a linha com a modalidade, e o ` – ` é
                            oportunidade de quebra — sem isto "07:00 – 08:00" racha. */}
                        <span className="whitespace-nowrap">
                          {formatTime(c.start_time)} – {formatTime(c.end_time)}
                        </span>
                        {c.sport && <span className="ml-2 text-slate-300">{sportEmoji(c.sport)} {sportLabel(c.sport)}</span>}
                      </p>

                      <p className="text-xs text-slate-400 mb-2">
                        <span className="text-sm font-extrabold text-white">{rc.enrolled}</span> matriculados ·{' '}
                        <span className="text-sm font-extrabold text-green-400">{rc.eligible}</span> reservados{' '}
                        <span className="text-slate-500">/ {c.max_students}</span>
                      </p>

                      <div className="flex flex-wrap gap-1.5 mb-2">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-green-400 bg-green-500/10 border border-green-500/30">✅ {rc.eligible} elegíveis</span>
                        {rc.pendingConfirmation > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-blue-400 bg-blue-500/10 border border-blue-500/30">🔵 {rc.pendingConfirmation} a confirmar</span>}
                        {rc.noPlan > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-yellow-400 bg-yellow-500/10 border border-yellow-500/30">⚠️ {rc.noPlan} sem plano</span>}
                      </div>

                      <p className="text-xs text-slate-500 mb-2">
                        {gen ? <>Próxima gerada: <span className="text-slate-400">{formatDate(gen.lastDate)}</span> · gerada {ago(gen.lastCreated)}</> : 'Ainda não gerada'}
                      </p>

                      <div className="flex items-center justify-between pt-2 border-t border-surface-border">
                        <Link href={`/admin/grade/${c.id}/editar`} className="text-xs font-semibold text-brand-500 hover:underline">Ver alunos →</Link>
                        <DeleteClassButton classId={c.id} className={c.name} />
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
