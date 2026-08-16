// app/(admin)/grade/[sessionId]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { AttendanceSheet } from '@/features/aulas/AttendanceSheet'
import { StartClassClient } from '@/features/aulas/StartClassClient'
import { markAttendance } from '@/features/aulas/actions'
import { AddStudentToSession, type AddableStudent } from '@/features/aulas/AddStudentToSession'
import { addStudentToSession, removeStudentFromSession } from '@/features/aulas/adminActions'
import { getSessionWaitlist } from '@/features/aulas/waitlistQueries'
import { WaitlistPanel } from '@/features/aulas/WaitlistPanel'
import { isSubscriptionCurrent } from '@/lib/billing/periodicity'
import { recordCheckin } from '@/features/checkin/actions'
import { countOpenMissedCheckinsByStudent } from '@/features/checkin/missedCheckinSettings'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import type {
  ClassSession,
  Profile,
  Membership,
  Attendance,
  CheckinPartner,
  SelfCheckinStatus,
  SelfCheckinGeoError,
} from '@/types'
import { RegenerateTodayButton } from '../RegenerateTodayButton'
import { brtToday } from '@/lib/utils/gridSchedule'
import { requirePlatformAccess } from '@/lib/billing/guard'
import { resolveSession } from '@/lib/aulas/sessionOverride'
import { SessionOverrideForm } from '@/features/aulas/SessionOverrideForm'

interface Props {
  params: { sessionId: string }
}

export default async function SessionDetailPage({ params }: Props) {
  await requirePlatformAccess() // gate de cobranca; ver lib/billing/guard.ts
  const adminClient = createAdminClient()
  // Cast como em /admin/financeiro/cobranca: o layout do (admin) já garantiu a
  // academia ativa antes de qualquer página renderizar.
  const orgId = (await getCurrentOrgId()) as string

  // Fetch session + class
  const { data: session } = await adminClient
    .from('class_sessions')
    .select('*, class:classes(*)')
    .eq('id', params.sessionId)
    .eq('organization_id', orgId)
    .single()

  if (!session) notFound()

  const typedSession = session as ClassSession & {
    class: {
      id: string
      name: string
      level: string
      type: string
      start_time: string
      end_time: string
      max_students: number
      court: number | null
    }
  }
  const cls = Array.isArray(typedSession.class) ? typedSession.class[0] : typedSession.class

  // Horário, quadra e lotação DESTA data: podem ter sido alterados só para hoje
  // (lib/aulas/sessionOverride). Ler o da turma mostraria o horário velho na
  // própria tela em que o professor acabou de remarcar.
  const horario = resolveSession(typedSession, cls)

  // Quem a aula toca: reservas confirmadas + alunos fixos da turma, menos quem
  // avisou que não vem. Mesma regra da agenda do aluno — sem isso o fixo sem
  // reserva gerada não aparece na chamada e a falta dele nunca é registrada.
  const { data: bookings } = await adminClient
    .from('session_bookings')
    .select('student_id, status')
    .eq('session_id', params.sessionId)
    .eq('organization_id', orgId)
    .in('status', ['confirmed', 'cancelled'])

  const bookingRows = (bookings ?? []) as { student_id: string; status: string }[]
  const confirmedIds = bookingRows.filter((b) => b.status === 'confirmed').map((b) => b.student_id)
  const optedOut = new Set(bookingRows.filter((b) => b.status === 'cancelled').map((b) => b.student_id))

  const { data: fixedRaw } = await adminClient
    .from('enrollments')
    .select('student_id')
    .eq('class_id', typedSession.class_id)
    .eq('organization_id', orgId)
    .eq('is_active', true)

  const fixedIds = ((fixedRaw ?? []) as { student_id: string }[]).map((e) => e.student_id)

  const seen = new Set<string>()
  const studentIds: string[] = []
  for (const id of [...confirmedIds, ...fixedIds.filter((f) => !optedOut.has(f))]) {
    if (seen.has(id)) continue
    seen.add(id)
    studentIds.push(id)
  }

  // Identidade (full_name) vem de profiles; nível/tipo são por-academia e vêm
  // da membership do aluno NESTA org.
  const { data: profiles } =
    studentIds.length > 0
      ? await adminClient
          .from('profiles')
          .select('id, full_name')
          .in('id', studentIds)
      : { data: [] }

  // Membership (nível/tipo/parceiro/crédito) de TODOS os alunos da academia,
  // buscada uma vez só: serve tanto os já matriculados nesta sessão (aviso de
  // dívida potencial, spec §UI/Riscos) quanto os candidatos a adicionar (spec
  // §6) — mesma regra de acesso do resolveClassAccess, sem o eixo dívida (aqui
  // só decide se avisa/pede motivo, nunca bloqueia). `level`/`payment_type` só
  // importam para quem já está matriculado.
  // Cadastro inativo NÃO é filtrado aqui de propósito. Este mapa serve duas coisas:
  // os dados de quem já está na chamada e a lista de candidatos a adicionar. Inativar
  // um aluno só cancela reserva FUTURA, então a chamada de uma aula passada continua
  // (corretamente) listando quem saiu — e sem a linha dele no mapa o nível apareceria
  // errado e `wouldOweDebt` viraria true à toa. Quem é filtrado é só o candidato,
  // mais abaixo.
  const { data: allMemsRaw } = await adminClient
    .from('memberships')
    .select('user_id, level, payment_type, partner, age_group, credits_balance, archived_at')
    .eq('organization_id', orgId)
    .eq('role', 'student')

  const memById = new Map<string, {
    level: Membership['level']
    payment_type: Membership['payment_type']
    partner: CheckinPartner | null
    ageGroup: Membership['age_group']
    credits_balance: number
    archived_at: string | null
  }>()
  for (const m of (allMemsRaw ?? []) as {
    user_id: string
    level: Membership['level']
    payment_type: Membership['payment_type']
    partner: CheckinPartner | null
    age_group: Membership['age_group'] | null
    credits_balance: number
    archived_at: string | null
  }[]) {
    memById.set(m.user_id, {
      level: m.level,
      payment_type: m.payment_type,
      partner: m.partner,
      // Linha anterior à migration do age_group lê null; ali todo mundo era adulto.
      ageGroup: m.age_group ?? 'adult',
      credits_balance: m.credits_balance,
      archived_at: m.archived_at,
    })
  }

  // Check-ins do dia desta aula e pendências de check-in em aberto: o professor
  // precisa dos dois na chamada — quem é de parceiro, quem já bipou, e quem já vem
  // acumulando falta. Uma query cada, para os alunos desta sessão.
  const { data: checkinsToday } =
    studentIds.length > 0
      ? await adminClient
          .from('checkins')
          .select('student_id')
          .eq('organization_id', orgId)
          .eq('checkin_date', typedSession.session_date)
          .in('student_id', studentIds)
      : { data: [] }

  const checkedInIds = new Set(
    ((checkinsToday ?? []) as { student_id: string }[]).map((c) => c.student_id),
  )

  const openMissedByStudent = await countOpenMissedCheckinsByStudent(
    adminClient,
    orgId,
    studentIds,
  )

  // Assinaturas ativas de TODA a academia, buscadas uma vez só (mesmo motivo).
  const { data: allSubsRaw } = await adminClient
    .from('student_subscriptions')
    .select('student_id, gateway, current_period_end')
    .eq('organization_id', orgId)
    .eq('status', 'active')

  const now = new Date()
  const planStudents = new Set(
    ((allSubsRaw ?? []) as { student_id: string; gateway: string; current_period_end: string | null }[])
      .filter((s) => isSubscriptionCurrent(s, now))
      .map((s) => s.student_id),
  )

  function hasAccess(studentId: string): boolean {
    const mem = memById.get(studentId)
    return !!mem?.partner || planStudents.has(studentId) || (mem?.credits_balance ?? 0) >= 1
  }

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

  // Confirmações que os alunos mandaram pelo app. As validadas já geraram
  // presença; as pendentes esperam o professor decidir aqui.
  const { data: selfCheckinsRaw } =
    studentIds.length > 0
      ? await adminClient
          .from('self_checkins')
          .select('id, student_id, status, distance_m, geo_error')
          .eq('session_id', params.sessionId)
          .eq('organization_id', orgId)
          .in('student_id', studentIds)
      : { data: [] }

  const selfCheckinByStudent = new Map(
    ((selfCheckinsRaw ?? []) as {
      id: string
      student_id: string
      status: SelfCheckinStatus
      distance_m: number | string | null
      geo_error: SelfCheckinGeoError | null
    }[]).map((s) => [
      s.student_id,
      {
        id: s.id,
        status: s.status,
        distanceM: s.distance_m === null ? null : Number(s.distance_m),
        geoError: s.geo_error,
      },
    ]),
  )

  const students = (profiles ?? [])
    .map((p: Pick<Profile, 'id' | 'full_name'>) => {
      const mem = memById.get(p.id)
      return {
        student: {
          id: p.id,
          full_name: p.full_name,
          level: mem?.level ?? ('iniciante' as Membership['level']),
          payment_type: mem?.payment_type ?? ('per_class' as Membership['payment_type']),
        },
        attendance: attendanceByStudent.get(p.id) ?? null,
        wouldOweDebt: !hasAccess(p.id),
        partner: mem?.partner ?? null,
        checkedInToday: checkedInIds.has(p.id),
        openMissedCheckins: openMissedByStudent.get(p.id) ?? 0,
        selfCheckin: selfCheckinByStudent.get(p.id) ?? null,
      }
    })
    .sort((a, b) => a.student.full_name.localeCompare(b.student.full_name, 'pt-BR'))

  // Alunos da academia que ainda NÃO estão nesta sessão (candidatos a adicionar).
  // Cadastro inativo fica fora: quem saiu da academia não deve poder ser adicionado
  // a uma aula.
  const candidateIds = Array.from(memById.entries())
    .filter(([id, mem]) => !mem.archived_at && !studentIds.includes(id))
    .map(([id]) => id)

  const { data: candidateProfiles } =
    candidateIds.length > 0
      ? await adminClient.from('profiles').select('id, full_name').in('id', candidateIds)
      : { data: [] }

  const openMissedByCandidate = await countOpenMissedCheckinsByStudent(
    adminClient,
    orgId,
    candidateIds,
  )

  const addableStudents: AddableStudent[] = (candidateProfiles ?? [])
    .map((p: Pick<Profile, 'id' | 'full_name'>) => ({
      id: p.id,
      full_name: p.full_name,
      wouldOweDebt: !hasAccess(p.id),
      openMissedCheckins: openMissedByCandidate.get(p.id) ?? 0,
      ageGroup: memById.get(p.id)?.ageGroup ?? 'adult',
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  const waitlist = await getSessionWaitlist(adminClient, params.sessionId, orgId)

  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()
  const orgName = (orgRow as { name: string } | null)?.name ?? 'sua academia'

  // Aula concluída também conta como iniciada: a chamada já foi feita e o
  // professor ainda precisa poder corrigir uma marcação errada.
  const classStarted = !!typedSession.started_at || typedSession.status === 'completed'

  const isToday = typedSession.session_date === brtToday(new Date())

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
          {formatDate(typedSession.session_date)} ·{' '}
          {/* nowrap: divide a linha com a data, e o ` – ` quebraria o horário. */}
          <span className="whitespace-nowrap">
            {formatTime(horario.startTime)} – {formatTime(horario.endTime)}
          </span>
          {horario.court !== null && <> · Quadra {horario.court}</>}
        </p>
      </div>

      {/* Editar só ESTA data — remarcar, trocar de quadra, mudar a lotação ou
          cancelar o dia — sem mexer na turma e, com ela, em todas as semanas
          seguintes. Editar a turma inteira fica em /admin/grade/turma/[classId]/editar. */}
      <SessionOverrideForm
        sessionId={params.sessionId}
        sessionDate={typedSession.session_date}
        status={typedSession.status}
        cancelledReason={typedSession.cancelled_reason}
        booked={students.length}
        current={{
          start_time: typedSession.start_time,
          end_time: typedSession.end_time,
          court: typedSession.court,
          max_students: typedSession.max_students,
        }}
        classDefaults={{
          start_time: cls.start_time,
          end_time: cls.end_time,
          court: cls.court ?? null,
          max_students: cls.max_students,
        }}
      />

      <AddStudentToSession
        sessionId={params.sessionId}
        classType={cls.type === 'kids' ? 'kids' : 'adult'}
        students={addableStudents}
        onAdd={addStudentToSession}
      />

      <WaitlistPanel
        entries={waitlist}
        orgName={orgName}
        className={cls.name}
        sessionDate={typedSession.session_date}
        startTime={horario.startTime}
      />

      {students.length === 0 && typedSession.status !== 'completed' ? (
        <div className="border border-dashed border-surface-border rounded-xl p-5 text-center space-y-3">
          <p className="text-sm text-slate-400">Ninguém reservado ainda para esta aula.</p>
          {isToday ? (
            <>
              <p className="text-xs text-slate-500">Adicione um aluno avulso acima, ou regere o dia para reservar quem já tem plano/parceiro ativo.</p>
              <div className="flex justify-center">
                <RegenerateTodayButton dayOfWeek={new Date(typedSession.session_date + 'T12:00:00').getDay()} />
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Adicione um aluno avulso acima.</p>
          )}
        </div>
      ) : (
        <>
          {/* Iniciar vem ANTES da lista: é a ação que abre a chamada, e sem ela
              presença/falta ficam travadas (ver AttendanceSheet). */}
          <StartClassClient
            sessionId={params.sessionId}
            students={students}
            isCompleted={typedSession.status === 'completed'}
            startedAt={typedSession.started_at}
          />

          <AttendanceSheet
            sessionId={params.sessionId}
            students={students}
            classStarted={classStarted}
            onMark={markAttendance}
            onRecordCheckin={recordCheckin}
            onRemove={removeStudentFromSession}
          />
        </>
      )}
    </div>
  )
}
