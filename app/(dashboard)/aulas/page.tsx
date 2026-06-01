// app/(dashboard)/aulas/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import { SessionList } from '@/features/aulas/SessionList'
import type { Class, ClassSession, Enrollment, SessionBooking } from '@/types'

export default async function AulasPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch active enrollments with class data
  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('*, class:classes(*)')
    .eq('student_id', user.id)
    .eq('is_active', true)

  const typedEnrollments = (enrollments ?? []) as (Enrollment & { class: Class })[]

  const classIds = typedEnrollments.map((e) => e.class_id)

  // Fetch upcoming sessions for enrolled classes (next 30 days)
  const today = new Date()
  const in30 = new Date()
  in30.setDate(today.getDate() + 30)
  const todayStr = today.toISOString().slice(0, 10)
  const in30Str = in30.toISOString().slice(0, 10)

  const { data: sessions } =
    classIds.length > 0
      ? await supabase
          .from('class_sessions')
          .select('*')
          .in('class_id', classIds)
          .gte('session_date', todayStr)
          .lte('session_date', in30Str)
          .neq('status', 'cancelled')
          .order('session_date', { ascending: true })
      : { data: [] }

  const sessionIds = (sessions ?? []).map((s: ClassSession) => s.id)

  // Fetch student bookings for those sessions
  const { data: bookings } =
    sessionIds.length > 0
      ? await supabase
          .from('session_bookings')
          .select('*')
          .eq('student_id', user.id)
          .in('session_id', sessionIds)
      : { data: [] }

  // Fetch enrolled_count per class
  const { data: enrollCounts } =
    classIds.length > 0
      ? await supabase
          .from('enrollments')
          .select('class_id')
          .in('class_id', classIds)
          .eq('is_active', true)
      : { data: [] }

  const countByClass = new Map<string, number>()
  for (const e of enrollCounts ?? []) {
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1)
  }

  const sessionsByClass = new Map<string, ClassSession[]>()
  for (const s of (sessions ?? []) as ClassSession[]) {
    const arr = sessionsByClass.get(s.class_id) ?? []
    arr.push(s)
    sessionsByClass.set(s.class_id, arr)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Minhas Aulas</h1>
        <span className="text-xs text-slate-400">{typedEnrollments.length} matrículas ativas</span>
      </div>

      {typedEnrollments.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-4xl mb-4">🎾</p>
          <p className="font-semibold text-white mb-1">Sem matrículas</p>
          <p className="text-sm">
            Você ainda não está matriculado em nenhuma turma fixa.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {typedEnrollments.map((enrollment) => {
            const c = enrollment.class
            const classSessions = sessionsByClass.get(c.id) ?? []
            const studentBookings = (bookings ?? []) as SessionBooking[]

            return (
              <div key={enrollment.id} className="space-y-1">
                <ClassCard
                  class_={c}
                  enrolledCount={countByClass.get(c.id) ?? 0}
                />
                <div className="px-1">
                  <p className="text-xs text-slate-500 mb-1">Próximas sessões</p>
                  <SessionList
                    sessions={classSessions}
                    bookings={studentBookings.filter((b) =>
                      classSessions.some((s) => s.id === b.session_id),
                    )}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
