// app/(dashboard)/aulas/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClassCard } from '@/features/aulas/ClassCard'
import type { Class, Enrollment } from '@/types'

export default async function AulasPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('*, class:classes(*)')
    .eq('student_id', user.id)
    .eq('is_active', true)
    .order('class(day_of_week)', { ascending: true })
    .order('class(start_time)', { ascending: true })

  const typedEnrollments = (enrollments ?? []) as (Enrollment & { class: Class })[]
  const classIds = typedEnrollments.map((e) => e.class_id)

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

  return (
    <div className="p-4 space-y-4 pb-24">
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
          <p className="text-xs mt-2">Solicite ao seu professor para te matricular.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {typedEnrollments.map((enrollment) => (
            <ClassCard
              key={enrollment.id}
              class_={enrollment.class}
              enrolledCount={countByClass.get(enrollment.class_id) ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
