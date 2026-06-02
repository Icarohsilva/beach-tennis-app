// app/(admin)/alunos/[id]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { StudentProfileClient } from './StudentProfileClient'
import type { Profile, Enrollment, Class, StudentLevel } from '@/types'

interface Props {
  params: { id: string }
}

const paymentLabel: Record<string, string> = {
  subscriber: 'Mensalista',
  per_class: 'Avulso',
  wellhub: 'Wellhub',
  totalpass: 'Totalpass',
}

export default async function StudentProfilePage({ params }: Props) {
  const adminClient = createAdminClient()

  // Fetch student profile
  const { data: profile } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', params.id)
    .eq('role', 'student')
    .single()

  if (!profile) notFound()

  const student = profile as Profile

  // Fetch active enrollments with class info
  const { data: enrollmentsRaw } = await adminClient
    .from('enrollments')
    .select('*, class:classes(id, name, level, type, day_of_week, start_time, end_time)')
    .eq('student_id', params.id)
    .eq('is_active', true)
    .order('class(day_of_week)', { ascending: true })

  type EnrollmentWithClass = Enrollment & {
    class: Pick<Class, 'id' | 'name' | 'level' | 'type' | 'day_of_week' | 'start_time' | 'end_time'>
  }
  const enrollments = (enrollmentsRaw ?? []) as EnrollmentWithClass[]

  // Fetch all active classes (for enrollment picker)
  const { data: allClassesRaw } = await adminClient
    .from('classes')
    .select('id, name, level, type, day_of_week, start_time, end_time, max_students, is_active')
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true })

  const allClasses = (allClassesRaw ?? []) as Class[]

  // Get enrollment counts to filter full classes
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

  const availableClasses = allClasses
    .filter((c) => {
      // Kids classes only available if student is a dependent (admin override)
      if (c.type === 'kids' && !student.is_dependent) return false
      // Adult classes only for non-dependents
      if (c.type === 'adult' && student.is_dependent) return false
      const count = enrollCountMap.get(c.id) ?? 0
      return count < c.max_students
    })
    .map((c) => ({
      id: c.id,
      name: c.name,
      level: c.level,
      type: c.type,
      day_of_week: c.day_of_week,
      start_time: c.start_time,
      end_time: c.end_time,
    }))

  // Fetch dependents (if student is not a dependent themselves)
  const dependents: { id: string; full_name: string; level: StudentLevel }[] = []
  if (!student.is_dependent) {
    const { data: depsRaw } = await adminClient
      .from('profiles')
      .select('id, full_name, level')
      .eq('parent_id', params.id)
      .eq('is_dependent', true)
      .order('full_name', { ascending: true })

    for (const d of (depsRaw ?? []) as Pick<Profile, 'id' | 'full_name' | 'level'>[]) {
      dependents.push({ id: d.id, full_name: d.full_name, level: d.level as StudentLevel })
    }
  }

  // Fetch active subscription plans (for plan assignment)
  const { data: plansRaw } = await adminClient
    .from('subscription_plans')
    .select('id, name, classes_per_week, credits_per_month, price_monthly, is_active')
    .eq('is_active', true)
    .order('classes_per_week', { ascending: true })

  const availablePlans = (plansRaw ?? []) as {
    id: string
    name: string
    classes_per_week: number
    credits_per_month: number
    price_monthly: number
    is_active: boolean
  }[]

  // Fetch current active subscription for this student
  const { data: currentSubRaw } = await adminClient
    .from('student_subscriptions')
    .select('id, plan_id, status, starts_at, plan:subscription_plans(id, name)')
    .eq('student_id', params.id)
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentSubscription = currentSubRaw as {
    id: string
    plan_id: string
    status: string
    starts_at: string
    plan: { id: string; name: string } | null
  } | null

  // Recent credit transactions
  const { data: creditsRaw } = await adminClient
    .from('credit_transactions')
    .select('id, type, amount, reason, created_at, expires_at')
    .eq('student_id', params.id)
    .order('created_at', { ascending: false })
    .limit(10)

  const credits = (creditsRaw ?? []) as {
    id: string
    type: string
    amount: number
    reason: string
    created_at: string
    expires_at: string | null
  }[]

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/admin/alunos" className="hover:text-white transition-colors">
          Alunos
        </Link>
        <span>/</span>
        <span className="text-white">{student.full_name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">{student.full_name}</h1>
            {student.is_dependent && <Badge variant="kids">KIDS</Badge>}
            <Badge variant="level">{student.level.toUpperCase()}</Badge>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-slate-400">
            {student.phone && <span>📞 {student.phone}</span>}
            <span
              className={student.contract_active ? 'text-green-400' : 'text-red-400'}
            >
              {paymentLabel[student.payment_type] ?? student.payment_type}
              {!student.contract_active && ' (inativo)'}
            </span>
            {student.payment_type === 'subscriber' && (
              <span className="text-slate-300">
                {student.credits_balance} crédito{student.credits_balance !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Interactive section (level, enrollments, dependents, subscription) */}
      <Card>
        <StudentProfileClient
          studentId={student.id}
          currentLevel={student.level as StudentLevel}
          enrollments={enrollments}
          availableClasses={availableClasses}
          dependents={dependents}
          isDependent={student.is_dependent}
          availablePlans={availablePlans}
          currentSubscription={currentSubscription}
        />
      </Card>

      {/* Recent credit transactions */}
      {student.payment_type === 'subscriber' && credits.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Histórico de Créditos</h2>
          <div className="space-y-2">
            {credits.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-card border border-surface-border rounded-xl text-sm"
              >
                <div className="min-w-0">
                  <p className="text-white truncate">{t.reason}</p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {new Date(t.created_at).toLocaleDateString('pt-BR')}
                    {t.expires_at &&
                      ` · expira ${new Date(t.expires_at).toLocaleDateString('pt-BR')}`}
                  </p>
                </div>
                <span
                  className={[
                    'font-semibold shrink-0',
                    t.amount > 0 ? 'text-green-400' : 'text-red-400',
                  ].join(' ')}
                >
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
