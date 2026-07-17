// app/(admin)/grade/[sessionId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { AttendanceSheet } from '@/features/aulas/AttendanceSheet'
import { StartClassClient } from '@/features/aulas/StartClassClient'
import { markAttendance } from '@/features/aulas/actions'
import { AddStudentToSession, type AddableStudent } from '@/features/aulas/AddStudentToSession'
import { addStudentToSession } from '@/features/aulas/adminActions'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type { ClassSession, Profile, Membership, Attendance } from '@/types'

interface Props {
  params: { sessionId: string }
}

export default async function SessionDetailPage({ params }: Props) {
  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  // Fetch session + class
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(*)')
    .eq('id', params.sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) notFound()

  const typedSession = session as ClassSession & {
    class: { id: string; name: string; level: string; type: string; start_time: string; end_time: string; max_students: number }
  }
  const cls = Array.isArray(typedSession.class) ? typedSession.class[0] : typedSession.class

  // Fetch confirmed bookings for the session
  const { data: bookings } = await adminClient
    .from('session_bookings')
    .select('student_id')
    .eq('session_id', params.sessionId)
    .eq('organization_id', orgId)
    .eq('status', 'confirmed')

  const studentIds = (bookings ?? []).map((b: { student_id: string }) => b.student_id)

  // Identidade (full_name) vem de profiles; nível/tipo são por-academia e vêm
  // da membership do aluno NESTA org.
  const { data: profiles } =
    studentIds.length > 0
      ? await adminClient
          .from('profiles')
          .select('id, full_name')
          .in('id', studentIds)
      : { data: [] }

  const { data: memsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('memberships')
          .select('user_id, level, payment_type, partner, credits_balance')
          .in('user_id', studentIds)
          .eq('organization_id', orgId)
      : { data: [] }

  const memByStudent = new Map<string, {
    level: Membership['level']
    payment_type: Membership['payment_type']
    partner: string | null
    credits_balance: number
  }>()
  for (const m of (memsRaw ?? []) as {
    user_id: string
    level: Membership['level']
    payment_type: Membership['payment_type']
    partner: string | null
    credits_balance: number
  }[]) {
    memByStudent.set(m.user_id, {
      level: m.level,
      payment_type: m.payment_type,
      partner: m.partner,
      credits_balance: m.credits_balance,
    })
  }

  // Dívida potencial: aviso ao professor ANTES de marcar presença — mitigação
  // documentada no spec (§UI, tabela de Riscos) para "dívida só nasce na
  // presença". Mesma regra de acesso do resolveClassAccess, sem o eixo dívida
  // (aqui só decide se avisa, nunca bloqueia).
  const { data: bookedSubsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, gateway, current_period_end')
          .in('student_id', studentIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const bookedPlanStudents = new Set(
    ((bookedSubsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, new Date()))
      .map((s) => s.student_id),
  )

  // Fetch attendances for this session
  const { data: attendances } =
    studentIds.length > 0
      ? await adminClient
          .from('attendance')
          .select('*')
          .eq('session_id', params.sessionId)
          .eq('organization_id', orgId)
          .in('student_id', studentIds)
      : { data: [] }

  const attendanceByStudent = new Map(
    (attendances ?? []).map((a: Attendance) => [a.student_id, a]),
  )

  const students = (profiles ?? [])
    .map((p: Pick<Profile, 'id' | 'full_name'>) => {
      const mem = memByStudent.get(p.id)
      const hasAccess =
        !!mem?.partner || bookedPlanStudents.has(p.id) || (mem?.credits_balance ?? 0) >= 1
      return {
        student: {
          id: p.id,
          full_name: p.full_name,
          level: mem?.level ?? ('iniciante' as Membership['level']),
          payment_type: mem?.payment_type ?? ('per_class' as Membership['payment_type']),
        },
        attendance: attendanceByStudent.get(p.id) ?? null,
        wouldOweDebt: !hasAccess,
      }
    })
    .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name, 'pt-BR'))

  // Alunos da academia que ainda NÃO estão nesta sessão. `wouldOweDebt` decide
  // se o seletor de motivo aparece — mesma regra do resolveClassAccess, mas sem
  // o eixo dívida: o admin ignora o bloqueio (spec §1).
  const { data: allMemsRaw } = await adminClient
    .from('memberships')
    .select('user_id, partner, credits_balance')
    .eq('organization_id', orgId)
    .eq('role', 'student')

  const allMems = (allMemsRaw ?? []) as {
    user_id: string
    partner: string | null
    credits_balance: number
  }[]
  const candidateIds = allMems.map((m) => m.user_id).filter((id) => !studentIds.includes(id))

  const { data: candidateProfiles } =
    candidateIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', candidateIds)
      : { data: [] }

  const { data: candidateSubsRaw } =
    candidateIds.length > 0
      ? await adminClient
          .from('student_subscriptions')
          .select('student_id, gateway, current_period_end')
          .in('student_id', candidateIds)
          .eq('organization_id', orgId)
          .eq('status', 'active')
      : { data: [] }

  const now = new Date()
  const planStudents = new Set(
    ((candidateSubsRaw ?? []) as {
      student_id: string
      gateway: string
      current_period_end: string | null
    }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => s.student_id),
  )
  const memById = new Map(allMems.map((m) => [m.user_id, m]))

  const addableStudents: AddableStudent[] = (candidateProfiles ?? [])
    .map((p: Pick<Profile, 'id' | 'full_name'>) => {
      const mem = memById.get(p.id)
      const hasAccess =
        !!mem?.partner || planStudents.has(p.id) || (mem?.credits_balance ?? 0) >= 1
      return { id: p.id, full_name: p.full_name, wouldOweDebt: !hasAccess }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/grade" className="text-slate-400 hover:text-white text-sm">
          ← Grade
        </Link>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white">{cls.name}</h1>
          {cls.type === 'kids' && <Badge variant="kids">KIDS</Badge>}
        </div>
        <p className="text-slate-400 text-sm">
          {formatDate(typedSession.session_date)} · {formatTime(cls.start_time)} – {formatTime(cls.end_time)}
        </p>
      </div>

      <AddStudentToSession
        sessionId={params.sessionId}
        students={addableStudents}
        onAdd={addStudentToSession}
      />

      <AttendanceSheet
        sessionId={params.sessionId}
        students={students}
        onMark={markAttendance}
      />

      <StartClassClient
        sessionId={params.sessionId}
        students={students}
        isCompleted={typedSession.status === 'completed'}
      />
    </div>
  )
}
