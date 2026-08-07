'use client'
// features/aulas/AttendanceSheet.tsx

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type {
  Profile,
  Membership,
  Attendance,
  AttendanceSource,
  CheckinPartner,
  SelfCheckinStatus,
  SelfCheckinGeoError,
} from '@/types'
import { selfCheckinGeoErrorLabel, formatDistance } from '@/lib/checkin/selfCheckin'
import { reviewSelfCheckin } from '@/features/checkin/selfCheckinActions'
import type { MissedCheckinEffect } from './actions'

/** Confirmação que o aluno mandou pelo app, para o professor conferir. */
export interface StudentSelfCheckin {
  id: string
  status: SelfCheckinStatus
  distanceM: number | null
  geoError: SelfCheckinGeoError | null
}

export interface StudentAttendance {
  // id/full_name = identidade (profiles); level/payment_type = por-academia (membership).
  student: Pick<Profile, 'id' | 'full_name'> & Pick<Membership, 'level' | 'payment_type'>
  attendance: Attendance | null
  wouldOweDebt: boolean
  /** Parceiro confirmado na academia. null = não é aluno de parceiro. */
  partner: CheckinPartner | null
  /** Já existe check-in do aluno na data desta aula. */
  checkedInToday: boolean
  /** Pendências de check-in em aberto antes desta chamada. */
  openMissedCheckins: number
  /** Confirmação de presença enviada pelo aluno no app. */
  selfCheckin?: StudentSelfCheckin | null
}

interface AttendanceSheetProps {
  sessionId: string
  students: StudentAttendance[]
  /**
   * A aula já foi iniciada. Enquanto for false a chamada é só leitura: presença
   * e falta só passam a valer depois que o professor inicia a aula.
   */
  classStarted: boolean
  onMark: (
    sessionId: string,
    studentId: string,
    present: boolean,
  ) => Promise<{ error?: string; missed?: MissedCheckinEffect }>
  /** Registra o check-in do parceiro na mão, recuperando o repasse. */
  onRecordCheckin: (
    studentId: string,
    partner: CheckinPartner,
  ) => Promise<{ error?: string }>
  /** Tira o aluno só desta aula. giveBack = devolver a aula a ele. */
  onRemove: (
    sessionId: string,
    studentId: string,
    giveBack: boolean,
  ) => Promise<{ error?: string; refunded?: boolean; quotaWaived?: boolean }>
}

const SOURCE_LABEL: Record<AttendanceSource, string> = {
  manual: 'Manual',
  wellhub: 'Wellhub',
  totalpass: 'Totalpass',
  self: 'App',
}

const SOURCE_VARIANT: Record<AttendanceSource, 'default' | 'success' | 'warning'> = {
  manual: 'default',
  wellhub: 'success',
  totalpass: 'warning',
  self: 'success',
}

const PARTNER_LABEL: Record<CheckinPartner, string> = {
  wellhub: 'Wellhub',
  totalpass: 'TotalPass',
}

const PARTNER_VARIANT: Record<CheckinPartner, 'success' | 'warning'> = {
  wellhub: 'success',
  totalpass: 'warning',
}

export function AttendanceSheet({
  sessionId,
  students,
  classStarted,
  onMark,
  onRecordCheckin,
  onRemove,
}: AttendanceSheetProps) {
  const [attendanceMap, setAttendanceMap] = useState<
    Map<string, { status: 'present' | 'absent'; source: AttendanceSource }>
  >(() => {
    const map = new Map()
    for (const s of students) {
      if (s.attendance) {
        map.set(s.student.id, {
          status: s.attendance.status === 'late' ? 'present' : s.attendance.status,
          source: s.attendance.source,
        })
      }
    }
    return map
  })

  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  // Efeito da falta na pendência de check-in, por aluno — feedback imediato do que
  // a marcação causou (pendência criada, e se bloqueou o aluno).
  const [missedMap, setMissedMap] = useState<Map<string, MissedCheckinEffect>>(new Map())
  // Check-in registrado na mão agora, sem esperar o refresh do servidor.
  const [checkedInNow, setCheckedInNow] = useState<Set<string>>(new Set())
  // Confirmações do app revisadas nesta tela, por aluno.
  const [reviewedNow, setReviewedNow] = useState<Map<string, SelfCheckinStatus>>(new Map())
  const [pendingStudent, setPendingStudent] = useState<string | null>(null)
  // Aluno em confirmação de remoção. O diálogo pergunta o que fazer com a aula
  // dele: devolver (estorna o crédito) ou consumir (leva a falta e perde).
  const [removing, setRemoving] = useState<StudentAttendance | null>(null)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  function setError(studentId: string, message: string | null) {
    setErrors((prev) => {
      const next = new Map(prev)
      if (message) next.set(studentId, message)
      else next.delete(studentId)
      return next
    })
  }

  function handleMark(studentId: string, present: boolean) {
    setPendingStudent(studentId)
    startTransition(async () => {
      const result = await onMark(sessionId, studentId, present)
      setPendingStudent(null)
      if (result.error) {
        setError(studentId, result.error)
        return
      }
      setError(studentId, null)
      setAttendanceMap((prev) =>
        new Map(prev).set(studentId, { status: present ? 'present' : 'absent', source: 'manual' }),
      )
      setMissedMap((prev) => {
        const next = new Map(prev)
        if (result.missed) next.set(studentId, result.missed)
        else next.delete(studentId)
        return next
      })
    })
  }

  function handleRemove(studentId: string, giveBack: boolean) {
    setPendingStudent(studentId)
    startTransition(async () => {
      const result = await onRemove(sessionId, studentId, giveBack)
      setPendingStudent(null)
      setRemoving(null)
      if (result.error) {
        setError(studentId, result.error)
        return
      }
      setError(studentId, null)
      setRemovedIds((prev) => new Set(prev).add(studentId))
    })
  }

  function handleRecordCheckin(studentId: string, partner: CheckinPartner) {
    setPendingStudent(studentId)
    startTransition(async () => {
      const result = await onRecordCheckin(studentId, partner)
      setPendingStudent(null)
      if (result.error) {
        setError(studentId, result.error)
        return
      }
      setError(studentId, null)
      setCheckedInNow((prev) => new Set(prev).add(studentId))
    })
  }

  function handleReviewSelfCheckin(studentId: string, selfCheckinId: string, approve: boolean) {
    setPendingStudent(studentId)
    startTransition(async () => {
      const result = await reviewSelfCheckin(selfCheckinId, approve)
      setPendingStudent(null)
      if (result.error) {
        setError(studentId, result.error)
        return
      }
      setError(studentId, null)
      setReviewedNow((prev) =>
        new Map(prev).set(studentId, approve ? 'validated' : 'rejected'),
      )
      // Aprovar marca presença no servidor; a linha reflete isso na hora.
      if (approve) {
        setAttendanceMap((prev) =>
          new Map(prev).set(studentId, { status: 'present', source: 'self' }),
        )
      }
    })
  }

  const presentCount = Array.from(attendanceMap.values()).filter((a) => a.status === 'present').length
  const partnerStudents = students.filter((s) => s.partner)
  const withCheckin = partnerStudents.filter(
    (s) => s.checkedInToday || checkedInNow.has(s.student.id),
  ).length
  const pendingSelf = students.filter(
    (s) => (reviewedNow.get(s.student.id) ?? s.selfCheckin?.status) === 'pending',
  ).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-slate-400">
        <span>{students.length} alunos inscritos</span>
        {classStarted && <span className="text-green-400">{presentCount} presentes</span>}
      </div>

      {!classStarted && (
        <p className="rounded-lg border border-surface-border bg-surface-card px-3 py-2 text-xs text-slate-400">
          A chamada abre quando você iniciar a aula. Quem já fez check-in entra
          como presente automaticamente. Até lá dá para remover quem avisou que
          não vem e liberar a vaga.
        </p>
      )}

      {partnerStudents.length > 0 && (
        <p className="text-xs text-slate-400">
          {partnerStudents.length} de parceiro ·{' '}
          <span className={withCheckin === partnerStudents.length ? 'text-green-400' : 'text-yellow-400'}>
            {withCheckin} com check-in hoje
          </span>
        </p>
      )}

      {/* Aviso antes de encerrar a aula: quem está pendente ainda NÃO tem presença
          e o encerramento em lote marcaria falta. */}
      {pendingSelf > 0 && (
        <p className="text-xs text-yellow-400">
          {pendingSelf} aluno{pendingSelf !== 1 ? 's' : ''} confirmou presença pelo app e aguarda
          sua validação.
        </p>
      )}

      {students.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-6">Nenhum aluno inscrito nesta sessão.</p>
      ) : (
        <ul className="space-y-2">
          {students.filter((s) => !removedIds.has(s.student.id)).map(({
            student,
            wouldOweDebt,
            partner,
            checkedInToday,
            openMissedCheckins,
            selfCheckin,
          }) => {
            const att = attendanceMap.get(student.id)
            const isPresent = att?.status === 'present'
            const isAbsent = att?.status === 'absent'
            const source = att?.source ?? null
            const err = errors.get(student.id)
            const missed = missedMap.get(student.id)
            const hasCheckin = checkedInToday || checkedInNow.has(student.id)
            const rowPending = isPending && pendingStudent === student.id
            // Aberto ANTES desta chamada, e o que a chamada acabou de causar.
            const openNow = missed?.openCount ?? openMissedCheckins
            // A revisão feita agora vence o que veio do servidor.
            const selfStatus = reviewedNow.get(student.id) ?? selfCheckin?.status ?? null

            return (
              <li
                key={student.id}
                className={[
                  'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors',
                  isPresent
                    ? 'border-green-500/50 bg-green-500/10'
                    : isAbsent
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-surface-border bg-surface-card',
                ].join(' ')}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{student.full_name}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {/* Selo do parceiro SEMPRE visível: o professor precisa saber
                        quem é Wellhub antes de marcar a chamada, não depois. */}
                    {partner && (
                      <Badge variant={PARTNER_VARIANT[partner]}>{PARTNER_LABEL[partner]}</Badge>
                    )}
                    {source && source !== 'manual' && (
                      <Badge variant={SOURCE_VARIANT[source]}>
                        check-in {SOURCE_LABEL[source]}
                      </Badge>
                    )}
                    {wouldOweDebt && (
                      <span className="text-xs text-yellow-400 font-medium">⚠️ sem plano/crédito</span>
                    )}
                    {partner && openNow > 0 && (
                      <span className="text-xs text-red-400 font-medium">
                        {openNow} pendência{openNow !== 1 ? 's' : ''} de check-in
                      </span>
                    )}
                    {selfStatus === 'validated' && (
                      <Badge variant="success">
                        confirmou no app
                        {selfCheckin?.distanceM != null
                          ? ` · ${formatDistance(selfCheckin.distanceM)}`
                          : ''}
                      </Badge>
                    )}
                  </div>

                  {/* Confirmou pelo app mas a localização não fechou: o professor
                      bate o martelo. Só ele sabe quem estava na quadra. */}
                  {selfStatus === 'pending' && selfCheckin && (
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-xs text-yellow-400">
                        ⚠️ {selfCheckinGeoErrorLabel(selfCheckin.geoError, selfCheckin.distanceM)}
                      </span>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => handleReviewSelfCheckin(student.id, selfCheckin.id, true)}
                        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => handleReviewSelfCheckin(student.id, selfCheckin.id, false)}
                        className="text-xs text-slate-400 hover:text-slate-300 underline disabled:opacity-50"
                      >
                        Recusar
                      </button>
                    </div>
                  )}

                  {selfStatus === 'rejected' && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      Confirmação do app recusada.
                    </p>
                  )}

                  {/* Presente sem check-in registrado = repasse que a academia vai
                      perder por falha do webhook ou esquecimento do aluno. Dá pra
                      recuperar aqui mesmo. */}
                  {partner && isPresent && !hasCheckin && (
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <span className="text-xs text-yellow-400">⚠️ sem check-in hoje</span>
                      <button
                        type="button"
                        disabled={rowPending}
                        onClick={() => handleRecordCheckin(student.id, partner)}
                        className="text-xs text-brand-400 hover:text-brand-300 underline disabled:opacity-50"
                      >
                        {rowPending ? 'Registrando…' : 'Registrar check-in'}
                      </button>
                    </div>
                  )}

                  {partner && isPresent && hasCheckin && (
                    <p className="text-xs text-green-400 mt-1.5">✓ check-in registrado</p>
                  )}

                  {missed?.blocked && (
                    <p className="text-xs text-red-400 mt-1.5">
                      🔒 Aluno bloqueado
                      {missed.cancelledBookings > 0
                        ? `, ${missed.cancelledBookings} reserva(s) futura(s) cancelada(s)`
                        : ''}
                    </p>
                  )}

                  {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
                </div>

                {/* Dois botões explícitos: "marcar quem não veio" é uma ação, não a
                    ausência de outra. O toggle único deixava ausente e não-marcado
                    indistinguíveis. Só ficam ativos com a aula iniciada. */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {classStarted && (
                    <div className="flex gap-1.5">
                      <Button
                        variant={isPresent ? 'primary' : 'secondary'}
                        size="sm"
                        loading={rowPending}
                        onClick={() => handleMark(student.id, true)}
                        aria-pressed={isPresent}
                      >
                        Presente
                      </Button>
                      <Button
                        variant={isAbsent ? 'danger' : 'secondary'}
                        size="sm"
                        loading={rowPending}
                        onClick={() => handleMark(student.id, false)}
                        aria-pressed={isAbsent}
                      >
                        Faltou
                      </Button>
                    </div>
                  )}
                  {hasCheckin && !classStarted && (
                    <span className="text-xs text-green-400">✓ check-in feito</span>
                  )}
                  <button
                    type="button"
                    disabled={rowPending}
                    onClick={() => setRemoving(students.find((s) => s.student.id === student.id) ?? null)}
                    className="text-xs text-red-400 underline hover:text-red-300 disabled:opacity-50"
                  >
                    Remover da aula
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {removing && (
        <RemoveStudentDialog
          student={removing}
          pending={isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={(refund) => handleRemove(removing.student.id, refund)}
        />
      )}
    </div>
  )
}

/**
 * Confirmação de remoção. O professor precisa dizer o que acontece com a aula
 * do aluno, porque as duas saídas são legítimas: quem avisou que não vem merece
 * a aula de volta; quem simplesmente não apareceu consome a aula.
 */
function RemoveStudentDialog({
  student,
  pending,
  onCancel,
  onConfirm,
}: {
  student: StudentAttendance
  pending: boolean
  onCancel: () => void
  onConfirm: (giveBack: boolean) => void
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-student-title"
    >
      <button
        type="button"
        aria-label="Cancelar"
        onClick={onCancel}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-surface-border bg-surface-card p-5 shadow-2xl">
        <h3 id="remove-student-title" className="text-base font-bold text-white">
          Remover {student.student.full_name} desta aula?
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Sai só desta aula. A matrícula e as próximas datas continuam como estão,
          e a vaga é liberada para a fila de espera.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(true)}
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand-500/60 disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-white">
              Devolver a aula e dar falta
            </span>
            <span className="block text-xs text-slate-400">
              O aluno fica com a aula para usar outro dia.
            </span>
          </button>

          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(false)}
            className="w-full rounded-xl border border-surface-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-red-500/60 disabled:opacity-50"
          >
            <span className="block text-sm font-semibold text-white">
              Só dar falta, consumindo a aula
            </span>
            <span className="block text-xs text-slate-400">
              A aula é gasta: não volta como crédito nem como saldo do plano.
            </span>
          </button>
        </div>

        {/* A devolução existe nas duas moedas. Dizer qual vale para ESTE aluno
            evita o professor achar que devolveu crédito para quem é de plano. */}
        <p className="mt-3 text-[11px] text-slate-500">
          {student.partner
            ? 'Como este aluno é de parceiro, devolver significa que a aula não entra na contagem do plano dele.'
            : 'Se a aula foi paga com crédito, o crédito volta para o saldo. Se o aluno é de plano, ela não entra na contagem do ciclo.'}
        </p>

        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="mt-3 w-full text-center text-xs text-slate-400 underline hover:text-slate-300 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
