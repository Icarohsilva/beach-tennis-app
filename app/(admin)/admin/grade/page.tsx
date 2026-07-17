// app/(admin)/grade/page.tsx
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatTime } from '@/lib/utils/dateHelpers'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { GenerateSessionsButton } from './GenerateSessionsButton'
import { DeleteClassButton } from './DeleteClassButton'
import { CalendarDays } from 'lucide-react'
import type { Class, ClassSession } from '@/types'

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default async function GradePage() {
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
  const today = new Date().toISOString().slice(0, 10)
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

  // Enrolled count per class + contagem de irregulares (sem plano/parceiro).
  // Partner/plano são por-academia: vêm da membership do aluno NESTA org (não
  // de profiles, que só reflete a academia padrão do aluno multi-vínculo).
  const classIds = allClasses.map((c) => c.id)
  const { data: enrollRowsRaw } =
    classIds.length > 0
      ? await adminClient
          .from('enrollments')
          .select('class_id, student_id')
          .in('class_id', classIds)
          .eq('organization_id', orgId)
          .eq('is_active', true)
      : { data: [] }

  const enrollRows = (enrollRowsRaw ?? []) as { class_id: string; student_id: string }[]
  const enrolledStudentIds = Array.from(new Set(enrollRows.map((e) => e.student_id)))
  const { data: enrollMemsRaw } =
    enrolledStudentIds.length > 0
      ? await adminClient
          .from('memberships')
          .select('user_id, partner')
          .in('user_id', enrolledStudentIds)
          .eq('organization_id', orgId)
      : { data: [] }

  const partnerByStudent = new Map<string, string | null>()
  for (const m of (enrollMemsRaw ?? []) as { user_id: string; partner: string | null }[]) {
    partnerByStudent.set(m.user_id, m.partner)
  }

  const { data: subsRaw } =
    enrolledStudentIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, gateway, current_period_end')
          .in('student_id', enrolledStudentIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const now = new Date()
  const planStudents = new Set(
    ((subsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => s.student_id),
  )

  const enrollCountMap = new Map<string, number>()
  const noPlanMap = new Map<string, number>()
  for (const e of enrollRows) {
    enrollCountMap.set(e.class_id, (enrollCountMap.get(e.class_id) ?? 0) + 1)
    const hasPartner = !!partnerByStudent.get(e.student_id)
    if (!hasPartner && !planStudents.has(e.student_id)) {
      noPlanMap.set(e.class_id, (noPlanMap.get(e.class_id) ?? 0) + 1)
    }
  }

  const dayNumber = new Date().getDay() // 0=Sunday

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Grade de Aulas</h1>
        <div className="flex gap-2">
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
        <SectionHeader title={`Hoje — ${DAY_NAMES[dayNumber]}`} />
        {sessionsToday.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nenhuma sessão hoje." />
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
                      {clsRaw.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                    </div>
                    <p className="text-xs text-slate-400 mb-2">
                      {formatTime(clsRaw.start_time)} – {formatTime(clsRaw.end_time)}
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
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                {DAY_ABBR[day]}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {dayClasses.map((c) => {
                  const enrolled = enrollCountMap.get(c.id) ?? 0
                  const spotsLeft = c.max_students - enrolled
                  return (
                    <Card key={c.id}>
                      {/* Row 1: name + badges + edit link */}
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-white text-sm font-medium truncate">{c.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {c.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
                          <Link
                            href={`/admin/grade/${c.id}/editar`}
                            className="text-xs text-slate-400 hover:text-brand-500 ml-1"
                          >
                            Editar
                          </Link>
                        </div>
                      </div>
                      {/* Row 2: time */}
                      <p className="text-xs text-slate-400 mb-1">
                        {formatTime(c.start_time)} – {formatTime(c.end_time)}
                      </p>
                      {/* Row 3: vagas + alerta de plano */}
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-400">
                          <span className="text-sm font-extrabold text-brand-500">{enrolled}/{c.max_students}</span>{' '}
                          <span className={spotsLeft <= 0 ? 'text-red-400' : spotsLeft <= 3 ? 'text-yellow-400' : 'text-green-400'}>vagas</span>
                        </p>
                        {(noPlanMap.get(c.id) ?? 0) > 0 && (
                          <span className="text-xs text-yellow-400 font-medium">
                            ⚠️ {noPlanMap.get(c.id)} sem plano ativo
                          </span>
                        )}
                      </div>
                      <GenerateSessionsButton classId={c.id} />
                      <DeleteClassButton classId={c.id} className={c.name} />
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
