// app/(admin)/grade/page.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatTime } from '@/lib/utils/dateHelpers'
import type { Class, ClassSession } from '@/types'

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default async function GradePage() {
  const adminClient = createAdminClient()

  // Fetch all active classes
  const { data: classes } = await adminClient
    .from('classes')
    .select('*')
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (classes ?? []) as Class[]

  // Fetch today's sessions
  const today = new Date().toISOString().slice(0, 10)
  const { data: todaySessions } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(name, level, type, start_time, end_time, max_students)')
    .eq('session_date', today)
    .neq('status', 'cancelled')
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

  // Enrolled count per class
  const classIds = allClasses.map((c) => c.id)
  const { data: enrollCountsRaw } =
    classIds.length > 0
      ? await adminClient
          .from('enrollments')
          .select('class_id')
          .in('class_id', classIds)
          .eq('is_active', true)
      : { data: [] }

  const enrollCountMap = new Map<string, number>()
  for (const e of (enrollCountsRaw ?? []) as { class_id: string }[]) {
    enrollCountMap.set(e.class_id, (enrollCountMap.get(e.class_id) ?? 0) + 1)
  }

  const dayNumber = new Date().getDay() // 0=Sunday

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Grade de Aulas</h1>
        <span className="text-sm text-slate-400">{allClasses.length} turmas ativas</span>
      </div>

      {/* Today's sessions */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">
          Hoje — {DAY_NAMES[dayNumber]}
        </h2>
        {sessionsToday.length === 0 ? (
          <p className="text-slate-400 text-sm">Nenhuma sessão hoje.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessionsToday.map((session) => {
              const confirmed = bookingCountMap.get(session.id) ?? 0
              const max = session.class.max_students
              const isFull = confirmed >= max
              const clsRaw = Array.isArray(session.class) ? session.class[0] : session.class

              return (
                <Link key={session.id} href={`/admin/grade/${session.id}`}>
                  <Card className="hover:border-brand-600/50 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-white font-semibold text-sm">{clsRaw.name}</span>
                      <Badge variant={clsRaw.type === 'kids' ? 'kids' : 'level'}>
                        {clsRaw.type === 'kids' ? 'KIDS' : `Nível ${clsRaw.level}`}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      {formatTime(clsRaw.start_time)} – {formatTime(clsRaw.end_time)}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{confirmed}/{max} alunos</span>
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
        <h2 className="text-lg font-semibold text-white mb-3">Grade Semanal</h2>
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const dayClasses = classesByDay.get(day) ?? []
          if (dayClasses.length === 0) return null
          return (
            <div key={day} className="mb-4">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {DAY_ABBR[day]}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dayClasses.map((c) => {
                  const enrolled = enrollCountMap.get(c.id) ?? 0
                  const spotsLeft = c.max_students - enrolled
                  return (
                    <Card key={c.id}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-white text-sm font-medium truncate">{c.name}</span>
                        <div className="flex gap-1 shrink-0">
                          {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                          <Badge variant="level">{c.level.toUpperCase()}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{formatTime(c.start_time)} – {formatTime(c.end_time)}</span>
                        <span className={spotsLeft <= 0 ? 'text-red-400' : spotsLeft <= 3 ? 'text-yellow-400' : 'text-green-400'}>
                          {enrolled}/{c.max_students}
                        </span>
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
