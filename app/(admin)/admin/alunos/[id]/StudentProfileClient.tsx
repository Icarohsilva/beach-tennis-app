'use client'
// app/(admin)/alunos/[id]/StudentProfileClient.tsx

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { AgeGroup, StudentLevel, Enrollment, Class } from '@/types'
import {
  updateStudentLevel,
  updateStudentAgeGroup,
  updateStudentSports,
  enrollStudentInClass,
  previewGeneratedSessions,
  cancelEnrollment,
  addDependent,
  addCreditsManually,
} from '@/features/aulas/adminActions'
import { SportsPicker } from '@/components/ui/SportsPicker'
import { adminSubscribeStudentToPlan, adminCancelStudentPlan } from '@/features/financeiro/actions'
import { setStudentType, recordCheckin, clearPendingPartner } from '@/features/checkin/actions'
import { archiveStudent, reactivateStudent } from '@/features/aulas/archiveStudent'
import { countDistinctDays } from '@/lib/checkin/monthlyProgress'
import { formatDate } from '@/lib/utils/dateHelpers'
import { brtToday } from '@/lib/utils/gridSchedule'
import { ageGroupWarning } from '@/lib/aulas/ageGroup'

const LEVELS: StudentLevel[] = ['A', 'B', 'C', 'D', 'iniciante']

interface EnrollmentWithClass extends Enrollment {
  class: Pick<Class, 'id' | 'name' | 'level' | 'type' | 'day_of_week' | 'start_time' | 'end_time'>
}

interface AvailableClass {
  id: string
  name: string
  level: string
  type: string
  day_of_week: number
  start_time: string
  end_time: string
}

interface DependentSummary {
  id: string
  full_name: string
  level: StudentLevel
  /** Cadastro inativado na academia. null = ativo. */
  archivedAt: string | null
}

interface PlanSummary {
  id: string
  name: string
  classes_per_week: number
  is_active: boolean
}

interface CurrentSubscription {
  id: string
  plan_id: string
  status: string
  starts_at: string
  plan: { id: string; name: string } | null
}

interface StudentProfileClientProps {
  studentId: string
  organizationId: string
  currentLevel: StudentLevel
  /** Adulto ou kids nesta academia. */
  currentAgeGroup: AgeGroup
  currentSports: string[]
  orgSports: string[]
  currentCreditsBalance: number
  enrollments: EnrollmentWithClass[]
  availableClasses: AvailableClass[]
  dependents: DependentSummary[]
  isDependent: boolean
  availablePlans?: PlanSummary[]
  currentSubscription?: CurrentSubscription | null
  paymentType: string
  partner: 'wellhub' | 'totalpass' | null
  wellhubId: string | null
  totalpassId: string | null
  monthlyTarget: number
  orgDefaultTarget: number
  pendingPartner: 'wellhub' | 'totalpass' | null
  /** Cadastro inativado nesta academia. null = ativo. */
  archivedAt: string | null
  /** Alimenta o texto do diálogo: o admin precisa saber o que vai ser encerrado. */
  hasActivePlan: boolean
  activeEnrollmentCount: number
  checkins: {
    id: string
    partner: 'wellhub' | 'totalpass'
    checkin_date: string
    session_id: string | null
    validation: string
    created_at: string
  }[]
}

const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function formatTime(t: string) {
  return t.slice(0, 5)
}

export function StudentProfileClient({
  studentId,
  organizationId,
  currentLevel,
  currentAgeGroup,
  currentSports,
  orgSports,
  currentCreditsBalance,
  enrollments,
  availableClasses,
  dependents,
  isDependent,
  availablePlans = [],
  currentSubscription = null,
  paymentType,
  partner,
  wellhubId,
  totalpassId,
  monthlyTarget,
  orgDefaultTarget,
  pendingPartner,
  archivedAt,
  hasActivePlan,
  activeEnrollmentCount,
  checkins,
}: StudentProfileClientProps) {
  const [level, setLevel] = useState<StudentLevel>(currentLevel)
  const [ageGroup, setAgeGroup] = useState<AgeGroup>(currentAgeGroup)
  const [sports, setSports] = useState<string[]>(currentSports)
  const [enrollmentList, setEnrollmentList] = useState(enrollments)
  const [dependentList, setDependentList] = useState(dependents)
  const [creditsBalance, setCreditsBalance] = useState(currentCreditsBalance)

  const [selectedClassId, setSelectedClassId] = useState('')
  const [enrollPreview, setEnrollPreview] = useState<{ classId: string; count: number } | null>(null)
  const [newDependentName, setNewDependentName] = useState('')
  const [newDependentLevel, setNewDependentLevel] = useState<StudentLevel>('iniciante')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [activeSub, setActiveSub] = useState<CurrentSubscription | null>(currentSubscription ?? null)

  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [showCancelPlanDialog, setShowCancelPlanDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [archived, setArchived] = useState<string | null>(archivedAt)

  // Ativos e inativos vêm na mesma lista (a página precisa dos dois para dar caminho
  // de reativação) e são separados aqui.
  const activeDependents = dependentList.filter((d) => !d.archivedAt)
  const archivedDependents = dependentList.filter((d) => d.archivedAt)
  const [billing, setBilling] = useState<'subscriber' | 'per_class'>(
    paymentType === 'subscriber' ? 'subscriber' : 'per_class',
  )
  const [partnerType, setPartnerType] = useState<'none' | 'wellhub' | 'totalpass'>(
    partner ?? 'none',
  )
  const [partnerId, setPartnerId] = useState(
    (partner === 'totalpass' ? totalpassId : wellhubId) ?? '',
  )
  // Aluno sem meta própria (0) herda a meta padrão da academia como sugestão.
  const [targetInput, setTargetInput] = useState(
    String(monthlyTarget > 0 ? monthlyTarget : orgDefaultTarget),
  )
  const [linkedPartner, setLinkedPartner] = useState<'wellhub' | 'totalpass' | null>(partner)
  const [checkinList, setCheckinList] = useState(checkins)
  // Dias DISTINTOS, não linhas: duas aulas no mesmo dia contam 1 pra meta do mês
  // (spec 2026-07-29-checkin-diario-unico). Aplicado sobre as linhas que a página já
  // buscou pro histórico — sem query nova.
  const [checkinsDone, setCheckinsDone] = useState(countDistinctDays(checkins))
  const [pending, setPending] = useState<'wellhub' | 'totalpass' | null>(pendingPartner)

  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function notify(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  function handleLevelChange(newLevel: StudentLevel) {
    setLevel(newLevel)
    setError(null)
    startTransition(async () => {
      const result = await updateStudentLevel(studentId, newLevel)
      if (result.error) {
        setLevel(currentLevel)
        setError(result.error)
        return
      }
      notify('Nível atualizado.')
    })
  }

  function handleAgeGroupChange(next: AgeGroup) {
    const previous = ageGroup
    setAgeGroup(next)
    setError(null)
    startTransition(async () => {
      const result = await updateStudentAgeGroup(studentId, next)
      if (result.error) {
        setAgeGroup(previous)
        setError(result.error)
        return
      }
      notify('Tipo de aluno atualizado.')
    })
  }

  function handleSportsChange(next: string[]) {
    const previous = sports
    setSports(next)
    setError(null)
    startTransition(async () => {
      const result = await updateStudentSports(studentId, next)
      if (result.error) {
        setSports(previous)
        setError(result.error)
        return
      }
      notify('Esportes atualizados.')
    })
  }

  async function doEnroll(classId: string, linkGeneratedSessions: boolean) {
    const result = await enrollStudentInClass(studentId, classId, linkGeneratedSessions)
    if (result.error) {
      setError(result.error)
      return
    }
    // Refresh — find class data from available classes
    const cls = availableClasses.find((c) => c.id === classId)
    if (cls) {
      setEnrollmentList((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(), // temporary until page reload
          organization_id: organizationId,
          student_id: studentId,
          class_id: cls.id,
          enrolled_at: new Date().toISOString(),
          cancelled_at: null,
          is_active: true,
          class: cls as EnrollmentWithClass['class'],
        },
      ])
    }
    setSelectedClassId('')
    const parts: string[] = []
    if (result.booked) parts.push(`${result.booked} aula(s) reservada(s)`)
    if (result.waitlisted) parts.push(`${result.waitlisted} na fila de espera`)
    notify(parts.length ? `Matrícula criada. ${parts.join(', ')}.` : 'Matrícula criada.')
  }

  function handleEnroll() {
    if (!selectedClassId) return
    setError(null)
    startTransition(async () => {
      // Aula já gerada e cheia não pode receber o aluno em silêncio (era o bug
      // relatado): pergunta antes de vincular às sessões que já existem.
      const preview = await previewGeneratedSessions(selectedClassId)
      if (preview.error) {
        setError(preview.error)
        return
      }
      if (preview.count > 0) {
        setEnrollPreview({ classId: selectedClassId, count: preview.count })
        return
      }
      await doEnroll(selectedClassId, false)
    })
  }

  function handleConfirmEnrollPreview(link: boolean) {
    const preview = enrollPreview
    if (!preview) return
    setEnrollPreview(null)
    setError(null)
    startTransition(async () => {
      await doEnroll(preview.classId, link)
    })
  }

  function handleCancelEnrollment(enrollmentId: string) {
    setError(null)
    startTransition(async () => {
      const result = await cancelEnrollment(enrollmentId)
      if (result.error) {
        setError(result.error)
        return
      }
      setEnrollmentList((prev) => prev.filter((e) => e.id !== enrollmentId))
      notify('Matrícula cancelada.')
    })
  }

  function handleAddDependent() {
    if (!newDependentName.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addDependent(studentId, newDependentName, newDependentLevel)
      if (result.error || !result.dependentId) {
        setError(result.error ?? 'Erro ao criar dependente.')
        return
      }
      // Id REAL devolvido pela action, não um randomUUID: cada dependente da
      // lista é um link para a ficha dele, e um id inventado levaria a 404 até
      // a página ser recarregada.
      setDependentList((prev) => [
        ...prev,
        {
          id: result.dependentId!,
          full_name: newDependentName.trim(),
          level: newDependentLevel,
          archivedAt: null,
        },
      ])
      setNewDependentName('')
      setNewDependentLevel('iniciante')
      notify('Dependente adicionado.')
    })
  }

  function handleArchive() {
    setError(null)
    startTransition(async () => {
      const result = await archiveStudent(studentId)
      if (result.error) {
        setError(result.error)
        return
      }
      setArchived(new Date().toISOString())
      setShowArchiveDialog(false)
      // O painel inteiro reflete o novo estado (plano encerrado, matrículas
      // canceladas), então a mensagem resume o que de fato aconteceu em vez de um
      // "pronto!" genérico.
      const partes = ['Cadastro inativado']
      if (result.planCancelled) partes.push('assinatura encerrada')
      if (result.enrollmentsCancelled) {
        partes.push(
          `${result.enrollmentsCancelled} matrícula${result.enrollmentsCancelled > 1 ? 's' : ''} encerrada${result.enrollmentsCancelled > 1 ? 's' : ''}`,
        )
      }
      if (result.bookingsCancelled) {
        partes.push(
          `${result.bookingsCancelled} reserva${result.bookingsCancelled > 1 ? 's' : ''} cancelada${result.bookingsCancelled > 1 ? 's' : ''}`,
        )
      }
      notify(`${partes.join(' · ')}.`)
      setEnrollmentList([])
      setActiveSub(null)
    })
  }

  function handleReactivate() {
    setError(null)
    startTransition(async () => {
      const result = await reactivateStudent(studentId)
      if (result.error) {
        setError(result.error)
        return
      }
      setArchived(null)
      notify('Cadastro reativado. Matricule numa turma e associe um plano para ele voltar a agendar.')
    })
  }

  function handleSubscribe() {
    if (!selectedPlanId) return
    setError(null)
    startTransition(async () => {
      const result = await adminSubscribeStudentToPlan(studentId, selectedPlanId)
      if (result.error) {
        setError(result.error)
        return
      }
      const plan = availablePlans.find((p) => p.id === selectedPlanId)
      if (plan) {
        setActiveSub({
          id: crypto.randomUUID(),
          plan_id: plan.id,
          status: 'active',
          starts_at: new Date().toISOString(),
          plan: { id: plan.id, name: plan.name },
        })
      }
      setSelectedPlanId('')
      notify('Plano associado com sucesso.')
    })
  }

  function handleAddCredits() {
    const parsed = parseInt(creditAmount, 10)
    if (isNaN(parsed) || parsed === 0) {
      setError('Informe uma quantidade válida (pode ser negativa para remover).')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await addCreditsManually(studentId, parsed, creditReason)
      if (result.error) {
        setError(result.error)
        return
      }
      setCreditsBalance((prev) => prev + parsed)
      setCreditAmount('')
      setCreditReason('')
      notify(`${parsed > 0 ? '+' : ''}${parsed} crédito${Math.abs(parsed) !== 1 ? 's' : ''} ${parsed > 0 ? 'adicionado' : 'removido'}.`)
    })
  }

  function handleCancelPlan(clearCredits: boolean) {
    setShowCancelPlanDialog(false)
    setError(null)
    startTransition(async () => {
      const result = await adminCancelStudentPlan(studentId, clearCredits)
      if (result.error) {
        setError(result.error)
        return
      }
      setActiveSub(null)
      if (clearCredits) setCreditsBalance(0)
      notify('Plano cancelado.')
    })
  }

  function handleSaveBilling() {
    setError(null)
    startTransition(async () => {
      const result = await setStudentType(studentId, { billing })
      if (result.error) {
        setError(result.error)
        return
      }
      notify('Cobrança atualizada.')
    })
  }

  function handleSavePartner() {
    setError(null)
    if (partnerType === 'none') {
      startTransition(async () => {
        const result = await setStudentType(studentId, { partner: { type: null } })
        if (result.error) {
          setError(result.error)
          return
        }
        setLinkedPartner(null)
        notify('Parceiro desvinculado.')
      })
      return
    }
    const target = parseInt(targetInput, 10)
    if (Number.isNaN(target) || target < 0) {
      setError('Meta mensal inválida.')
      return
    }
    startTransition(async () => {
      const result = await setStudentType(studentId, {
        partner: { type: partnerType, partnerId, monthlyTarget: target },
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(partnerType)
      notify('Parceiro atualizado.')
    })
  }

  function handleRecordCheckin() {
    if (!linkedPartner) return
    setError(null)
    startTransition(async () => {
      const result = await recordCheckin(studentId, linkedPartner)
      if (result.error) {
        setError(result.error)
        return
      }
      setCheckinList((prev) => [
        {
          id: crypto.randomUUID(),
          partner: linkedPartner,
          // brtToday, não toISOString: o servidor grava a data em BRT
          // (`todayInBrt` em features/checkin/actions.ts). Com o UTC cru, um
          // check-in feito depois das 21h aparecia na lista com a data de amanhã
          // até o próximo carregamento.
          checkin_date: brtToday(new Date()),
          session_id: result.linkedSessionId ?? null,
          validation: 'manual',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
      if (result.progress) setCheckinsDone(result.progress.done)
      notify('Check-in registrado.')
    })
  }

  function handleConfirmPartner() {
    if (!pending) return
    const target = parseInt(targetInput, 10)
    if (Number.isNaN(target) || target < 0) {
      setError('Defina uma meta mensal válida antes de confirmar.')
      return
    }
    const declaredId = (pending === 'wellhub' ? wellhubId : totalpassId) ?? ''
    setError(null)
    startTransition(async () => {
      const result = await setStudentType(studentId, {
        partner: { type: pending, partnerId: declaredId, monthlyTarget: target },
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(pending)
      setPartnerType(pending)
      setPartnerId(declaredId)
      setTargetInput(String(target))
      setPending(null)
      notify('Parceiro confirmado.')
    })
  }

  function handleRejectPartner() {
    setError(null)
    startTransition(async () => {
      const result = await clearPendingPartner(studentId)
      if (result.error) {
        setError(result.error)
        return
      }
      setPending(null)
      notify('Solicitação recusada.')
    })
  }

  // Filter out already enrolled classes
  const enrolledClassIds = new Set(enrollmentList.map((e) => e.class_id))
  const eligibleClasses = availableClasses.filter((c) => !enrolledClassIds.has(c.id))

  return (
    <div className="space-y-8">
      {/* Feedback */}
      {successMsg && (
        <div className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-2">
          {successMsg}
        </div>
      )}
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2">
          {error}
        </div>
      )}

      {/* Level */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">Nível</h2>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              disabled={isPending}
              onClick={() => handleLevelChange(l)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                level === l
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'bg-surface-card border-surface-border text-slate-400 hover:border-slate-400 hover:text-white',
              ].join(' ')}
            >
              {l === 'iniciante' ? 'Iniciante' : `Nível ${l}`}
            </button>
          ))}
        </div>
      </section>

      {/* Adulto ou kids. Fica ao lado do nível porque é a mesma pergunta — "com quem
          esse aluno treina" — e porque o admin costuma acertar os dois de uma vez. */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">Tipo de aluno</h2>
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'adult' as const, label: 'Adulto' },
            { value: 'kids' as const, label: 'Kids' },
          ]).map((op) => (
            <button
              key={op.value}
              type="button"
              disabled={isPending}
              onClick={() => handleAgeGroupChange(op.value)}
              className={[
                'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                ageGroup === op.value
                  ? 'bg-brand-600 border-brand-500 text-white'
                  : 'bg-surface-card border-surface-border text-slate-400 hover:border-slate-400 hover:text-white',
              ].join(' ')}
            >
              {op.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Não bloqueia nada: serve para filtrar a lista de alunos e avisar quando a turma não
          combina com o aluno.
        </p>
      </section>

      {/* Esportes — base dos rankings da Liga. Não restringe turmas. */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">Esportes</h2>
        <SportsPicker
          value={sports}
          onChange={handleSportsChange}
          options={orgSports}
          allowCustom={false}
          label="Esportes que o aluno pratica nesta academia"
        />
        <p className="text-xs text-slate-500 mt-2">
          Define de quais rankings o aluno participa. Não afeta quais turmas ele pode frequentar.
        </p>
      </section>

      {/* Fixed enrollments */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">Matrículas Fixas</h2>

        {enrollmentList.length === 0 ? (
          <p className="text-slate-500 text-sm mb-3">Nenhuma matrícula ativa.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {enrollmentList.map((e) => {
              const cls = Array.isArray(e.class) ? e.class[0] : e.class
              return (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 bg-surface-card border border-surface-border rounded-xl"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{cls.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {DAY_ABBR[cls.day_of_week]} · {formatTime(cls.start_time)}–{formatTime(cls.end_time)}
                    </p>
                    {/* Turma que não combina com o tipo do aluno. Aviso, não trava:
                        só existe para a matrícula errada não passar despercebida. */}
                    {ageGroupWarning(ageGroup, cls.type === 'kids' ? 'kids' : 'adult') && (
                      <p className="mt-0.5 text-xs text-yellow-400">
                        ⚠️ {ageGroupWarning(ageGroup, cls.type === 'kids' ? 'kids' : 'adult')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={isPending}
                      onClick={() => handleCancelEnrollment(e.id)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Confirmação: turma já tem aula(s) gerada(s) — vincular ou não */}
        {enrollPreview && (
          <div className="bg-yellow-950/40 border border-yellow-800/50 rounded-xl px-4 py-3 mb-4 space-y-3">
            <p className="text-white text-sm font-semibold">
              Esta turma já tem {enrollPreview.count} aula{enrollPreview.count !== 1 ? 's' : ''} gerada{enrollPreview.count !== 1 ? 's' : ''} este mês.
            </p>
            <p className="text-slate-300 text-xs">
              Vincular o aluno a elas? Se a aula já estiver cheia, ele entra na fila de espera em vez de ocupar uma vaga que não existe.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="primary"
                size="sm"
                loading={isPending}
                onClick={() => handleConfirmEnrollPreview(true)}
              >
                Vincular às aulas já geradas
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={isPending}
                onClick={() => handleConfirmEnrollPreview(false)}
              >
                Só a partir da próxima geração
              </Button>
              <button
                type="button"
                onClick={() => setEnrollPreview(null)}
                className="text-xs text-slate-400 hover:text-white underline"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Enroll in new class */}
        {eligibleClasses.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">Matricular em turma</label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="">Selecione uma turma...</option>
                {eligibleClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {DAY_ABBR[c.day_of_week]} {formatTime(c.start_time)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={isPending}
              onClick={handleEnroll}
              disabled={!selectedClassId}
            >
              Matricular
            </Button>
          </div>
        )}
      </section>

      {/* Dependents (only for non-dependent adults) */}
      {!isDependent && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Dependentes (Kids)</h2>

          {activeDependents.length === 0 ? (
            <p className="text-slate-500 text-sm mb-3">Nenhum dependente cadastrado.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {/* Cada dependente abre a ficha dele — é de lá que se matricula numa
                  turma kids e se atribui o plano. Sem este link o admin tinha que
                  voltar na listagem geral e caçar o nome. */}
              {activeDependents.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/admin/alunos/${d.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2 bg-surface-card border border-surface-border rounded-xl transition-colors hover:border-brand-500/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-white text-sm">
                      {d.full_name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="kids">KIDS</Badge>
                      <span className="text-[11px] font-semibold text-brand-500">Ver ficha</span>
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* Dependentes inativos, à parte. Ficam aqui porque a listagem geral os
              esconde por padrão: sem esta lista o admin não teria caminho nenhum
              para reativar um dependente que ele mesmo inativou. Inativar sai pela
              ficha do dependente, junto do diálogo que diz o que vai ser encerrado. */}
          {archivedDependents.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Inativos
              </p>
              <ul className="space-y-2">
                {archivedDependents.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/admin/alunos/${d.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-surface-border bg-surface-card/50 px-4 py-2 transition-colors hover:border-brand-500/40"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-400">
                        {d.full_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="whitespace-nowrap text-[11px] text-slate-500">
                          desde {formatDate(d.archivedAt!)}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-600" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Add dependent */}
          <div className="space-y-2">
            {/* flex-wrap: nome + select de nível + botão pediam ~366px contra os
                240px de um card do admin em 320px. */}
            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-40 flex-1">
                <Input
                  label="Nome do dependente"
                  placeholder="Nome completo..."
                  value={newDependentName}
                  onChange={(e) => setNewDependentName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nível</label>
                <select
                  value={newDependentLevel}
                  onChange={(e) => setNewDependentLevel(e.target.value as StudentLevel)}
                  className="bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l === 'iniciante' ? 'Iniciante' : l}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={isPending}
                onClick={handleAddDependent}
                disabled={!newDependentName.trim()}
              >
                Adicionar
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Créditos manuais */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">
          Créditos ·{' '}
          <span className="text-brand-500">{creditsBalance}</span>{' '}
          disponíve{creditsBalance !== 1 ? 'is' : 'l'}
        </h2>
        <div className="space-y-2">
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Quantidade</label>
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Ex: 4 ou -1"
                className="w-24 bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-slate-400 mb-1">Motivo (opcional)</label>
              <input
                type="text"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="Ex: Aula reposição..."
                className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={isPending}
              onClick={handleAddCredits}
              disabled={!creditAmount.trim()}
            >
              Aplicar
            </Button>
          </div>
          <p className="text-xs text-slate-500">Use valor positivo para adicionar, negativo para remover.</p>
        </div>
      </section>

      {/* Plano de Assinatura */}
      {availablePlans.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Plano de Assinatura</h2>

          {/* Current plan */}
          {activeSub?.plan ? (
            <div className="px-4 py-3 bg-surface-card border border-surface-border rounded-xl mb-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white text-sm font-medium">{activeSub.plan.name}</p>
                  {activeSub.status === 'pending_payment' ? (
                    <p className="text-xs text-yellow-400 mt-0.5">Aguardando pagamento</p>
                  ) : activeSub.status === 'past_due' ? (
                    <p className="text-xs text-red-400 mt-0.5">Pagamento vencido</p>
                  ) : (
                    <p className="text-xs text-green-400 mt-0.5">
                      Ativo desde {new Date(activeSub.starts_at).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setShowCancelPlanDialog(true)}
                  className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50 shrink-0"
                >
                  {activeSub.status === 'pending_payment' ? 'Cancelar' : 'Remover plano'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-slate-500 text-sm mb-3">Nenhum plano ativo.</p>
          )}

          {/* Cancel plan confirmation dialog */}
          {showCancelPlanDialog && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 mb-4 space-y-3">
              <p className="text-white text-sm font-semibold">Remover plano do aluno?</p>
              <p className="text-slate-300 text-xs">
                Deseja também zerar os créditos do aluno ({creditsBalance} crédito{creditsBalance !== 1 ? 's' : ''})?
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="danger"
                  size="sm"
                  loading={isPending}
                  onClick={() => handleCancelPlan(true)}
                >
                  Remover plano e zerar créditos
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={isPending}
                  onClick={() => handleCancelPlan(false)}
                >
                  Remover plano, manter créditos
                </Button>
                <button
                  type="button"
                  onClick={() => setShowCancelPlanDialog(false)}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Assign plan */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">
                {activeSub ? 'Trocar plano' : 'Associar plano'}
              </label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="w-full bg-surface-card border border-surface-border rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="">Selecione um plano...</option>
                {availablePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.classes_per_week}x/sem
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={isPending}
              onClick={handleSubscribe}
              disabled={!selectedPlanId}
            >
              Assinar
            </Button>
          </div>
        </section>
      )}

      {/* Tipo de aluno: Mensalista / Wellhub / TotalPass */}
      <section className="pt-4 border-t border-surface-border">
        <h3 className="text-sm font-semibold text-white mb-2">Tipo de aluno</h3>

        <div className="flex flex-wrap gap-2 mb-3">
          <Badge variant="default">{billing === 'subscriber' ? 'Mensalista' : 'Avulso'}</Badge>
          {linkedPartner && (
            <Badge variant="default">{linkedPartner === 'wellhub' ? 'Wellhub' : 'TotalPass'}</Badge>
          )}
        </div>

        {pending && (
          <div className="mb-3 p-3 rounded-lg border border-yellow-700/50 bg-yellow-950/30">
            <p className="text-sm text-yellow-200">
              Solicitação de parceiro pendente:{' '}
              <strong>{pending === 'wellhub' ? 'Gympass (Wellhub)' : 'TotalPass'}</strong>
              {' · ID '}
              <span className="font-mono">
                {(pending === 'wellhub' ? wellhubId : totalpassId) || '—'}
              </span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Defina a meta mensal abaixo e confirme.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button onClick={handleConfirmPartner} disabled={isPending}>
                Confirmar
              </Button>
              <Button onClick={handleRejectPartner} disabled={isPending} variant="secondary">
                Recusar
              </Button>
            </div>
          </div>
        )}

        {/* Eixo cobrança */}
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400">
            Cobrança
            <select
              value={billing}
              onChange={(e) => setBilling(e.target.value as 'subscriber' | 'per_class')}
              className="mt-1 block bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="subscriber">Mensalista (plano)</option>
              <option value="per_class">Avulso</option>
            </select>
          </label>
          <Button onClick={handleSaveBilling} loading={isPending} size="sm" variant="secondary">
            Salvar cobrança
          </Button>
        </div>

        {/* Eixo parceiro */}
        <div className="flex flex-wrap gap-2 items-end mt-4">
          <label className="text-xs text-slate-400">
            Parceiro
            <select
              value={partnerType}
              onChange={(e) =>
                setPartnerType(e.target.value as 'none' | 'wellhub' | 'totalpass')
              }
              className="mt-1 block bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="none">Nenhum</option>
              <option value="wellhub">Wellhub</option>
              <option value="totalpass">TotalPass</option>
            </select>
          </label>
          {partnerType !== 'none' && (
            <>
              <label className="text-xs text-slate-400">
                ID do parceiro
                <Input value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="mt-1" />
              </label>
              <label className="text-xs text-slate-400">
                Meta mensal{' '}
                <span className="text-slate-500">(padrão da academia: {orgDefaultTarget})</span>
                <Input
                  type="number"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="mt-1 w-24"
                />
              </label>
            </>
          )}
          <Button onClick={handleSavePartner} loading={isPending} size="sm" variant="secondary">
            Salvar parceiro
          </Button>
        </div>

        {(linkedPartner === 'wellhub' || linkedPartner === 'totalpass') && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="min-w-0 text-sm text-slate-300">
                {checkinsDone} / {monthlyTarget} check-ins no mês
                {checkinsDone < monthlyTarget && (
                  <span className="text-yellow-400"> · faltam {monthlyTarget - checkinsDone}</span>
                )}
                {checkinsDone > monthlyTarget && monthlyTarget > 0 && (
                  <span className="text-green-400"> · {checkinsDone - monthlyTarget} adiantado(s)</span>
                )}
              </p>
              <Button onClick={handleRecordCheckin} disabled={isPending} size="sm">
                Registrar check-in
              </Button>
            </div>
            <ul className="space-y-1">
              {checkinList.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 text-xs px-3 py-2 bg-surface-card border border-surface-border rounded-lg"
                >
                  {/* formatDate, não `new Date(...)`: checkin_date é data pura
                      (yyyy-MM-dd) e o construtor a lê como meia-noite UTC —
                      exibida em BRT (UTC−3) voltava 3h, então o check-in do dia
                      01 aparecia como dia 31 do mês anterior e parecia que a
                      contagem do mês estava pegando o mês passado. */}
                  <span className="min-w-0 text-white">
                    {formatDate(c.checkin_date)}
                    {c.session_id && <span className="text-green-400"> · presença em aula</span>}
                  </span>
                  <span className="shrink-0">
                    <Badge variant={c.partner === 'wellhub' ? 'success' : 'warning'}>
                      {c.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}
                    </Badge>
                  </span>
                </li>
              ))}
              {checkinList.length === 0 && (
                <li className="text-slate-500 text-xs px-1">Nenhum check-in neste mês.</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* ── Situação do cadastro ────────────────────────────────────────────────
          Por último de propósito: é a ação destrutiva da ficha, e não deve estar
          no caminho de quem entrou para trocar o nível ou matricular numa turma. */}
      <section className="border-t border-surface-border pt-5">
        <h2 className="text-base font-semibold text-white mb-1">Situação do cadastro</h2>

        {archived ? (
          <>
            <p className="mb-3 text-sm text-slate-400">
              Inativo desde {formatDate(archived)}. O aluno está fora das listas, da
              chamada e da Liga.
            </p>
            <Button variant="secondary" size="sm" loading={isPending} onClick={handleReactivate}>
              Reativar cadastro
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Reativar devolve só a visibilidade. Turma e plano precisam ser
              refeitos — as regras de vaga e de cota valem de novo.
            </p>
          </>
        ) : showArchiveDialog ? (
          // O diálogo lista o que vai ser encerrado, com os números desta ficha.
          // Um "tem certeza?" genérico não deixaria claro que a assinatura do
          // responsável para de ser cobrada.
          <div className="space-y-3 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3">
            <p className="text-sm font-semibold text-white">
              Inativar o cadastro deste aluno na academia?
            </p>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>· Sai das listas, da chamada, da Liga e não pode ser agendado.</li>
              {activeEnrollmentCount > 0 && (
                <li>
                  · {activeEnrollmentCount} matrícula{activeEnrollmentCount > 1 ? 's' : ''} fixa
                  {activeEnrollmentCount > 1 ? 's' : ''} encerrada
                  {activeEnrollmentCount > 1 ? 's' : ''} — a vaga na turma fica livre.
                </li>
              )}
              <li>· Reservas futuras canceladas, com o crédito estornado.</li>
              {hasActivePlan && (
                <li className="text-yellow-300">
                  · A assinatura é encerrada: o responsável para de ser cobrado.
                </li>
              )}
              <li>
                · Presenças, extrato de crédito e pontuação da Liga são preservados. Os{' '}
                {creditsBalance} crédito{creditsBalance !== 1 ? 's' : ''} ficam guardados.
              </li>
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" size="sm" loading={isPending} onClick={handleArchive}>
                Inativar cadastro
              </Button>
              <button
                type="button"
                onClick={() => setShowArchiveDialog(false)}
                className="text-xs text-slate-400 underline hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-400">
              Aluno que saiu da academia. Inativar preserva todo o histórico e pode
              ser desfeito.
            </p>
            <Button variant="danger" size="sm" onClick={() => setShowArchiveDialog(true)}>
              Inativar cadastro
            </Button>
          </>
        )}
      </section>
    </div>
  )
}
