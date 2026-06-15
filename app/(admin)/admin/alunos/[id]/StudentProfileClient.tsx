'use client'
// app/(admin)/alunos/[id]/StudentProfileClient.tsx

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { StudentLevel, Enrollment, Class } from '@/types'
import {
  updateStudentLevel,
  enrollStudentInClass,
  cancelEnrollment,
  addDependent,
  addCreditsManually,
} from '@/features/aulas/adminActions'
import { adminSubscribeStudentToPlan, adminCancelStudentPlan } from '@/features/financeiro/actions'
import { setStudentType, recordCheckin, clearPendingPartner } from '@/features/checkin/actions'

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
}

interface PlanSummary {
  id: string
  name: string
  classes_per_week: number
  credits_per_month: number
  price_monthly: number
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
  currentLevel: StudentLevel
  currentCreditsBalance: number
  enrollments: EnrollmentWithClass[]
  availableClasses: AvailableClass[]
  dependents: DependentSummary[]
  isDependent: boolean
  availablePlans?: PlanSummary[]
  currentSubscription?: CurrentSubscription | null
  paymentType: string
  wellhubId: string | null
  totalpassId: string | null
  monthlyTarget: number
  pendingPartner: 'wellhub' | 'totalpass' | null
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
  currentLevel,
  currentCreditsBalance,
  enrollments,
  availableClasses,
  dependents,
  isDependent,
  availablePlans = [],
  currentSubscription = null,
  paymentType,
  wellhubId,
  totalpassId,
  monthlyTarget,
  pendingPartner,
  checkins,
}: StudentProfileClientProps) {
  const [level, setLevel] = useState<StudentLevel>(currentLevel)
  const [enrollmentList, setEnrollmentList] = useState(enrollments)
  const [dependentList, setDependentList] = useState(dependents)
  const [creditsBalance, setCreditsBalance] = useState(currentCreditsBalance)

  const [selectedClassId, setSelectedClassId] = useState('')
  const [newDependentName, setNewDependentName] = useState('')
  const [newDependentLevel, setNewDependentLevel] = useState<StudentLevel>('iniciante')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [activeSub, setActiveSub] = useState<CurrentSubscription | null>(currentSubscription ?? null)

  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [showCancelPlanDialog, setShowCancelPlanDialog] = useState(false)
  const [studentType, setStudentTypeState] = useState<'subscriber' | 'wellhub' | 'totalpass'>(
    paymentType === 'wellhub' || paymentType === 'totalpass' ? paymentType : 'subscriber',
  )
  const [partnerId, setPartnerId] = useState(
    (paymentType === 'totalpass' ? totalpassId : wellhubId) ?? '',
  )
  const [targetInput, setTargetInput] = useState(String(monthlyTarget))
  const [linkedPartner, setLinkedPartner] = useState<string>(paymentType)
  const [checkinList, setCheckinList] = useState(checkins)
  const [checkinsDone, setCheckinsDone] = useState(checkins.length)
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

  function handleEnroll() {
    if (!selectedClassId) return
    setError(null)
    startTransition(async () => {
      const result = await enrollStudentInClass(studentId, selectedClassId)
      if (result.error) {
        setError(result.error)
        return
      }
      // Refresh — find class data from available classes
      const cls = availableClasses.find((c) => c.id === selectedClassId)
      if (cls) {
        setEnrollmentList((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(), // temporary until page reload
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
      notify('Matrícula criada.')
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
      if (result.error) {
        setError(result.error)
        return
      }
      setDependentList((prev) => [
        ...prev,
        { id: crypto.randomUUID(), full_name: newDependentName.trim(), level: newDependentLevel },
      ])
      setNewDependentName('')
      setNewDependentLevel('iniciante')
      notify('Dependente adicionado.')
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

  function handleSaveType() {
    setError(null)
    if (studentType === 'subscriber') {
      startTransition(async () => {
        const result = await setStudentType(studentId, { type: 'subscriber' })
        if (result.error) {
          setError(result.error)
          return
        }
        setLinkedPartner('subscriber')
        notify('Tipo do aluno atualizado.')
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
        type: studentType,
        partnerId,
        monthlyTarget: target,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(studentType)
      notify('Tipo do aluno atualizado.')
    })
  }

  function handleRecordCheckin() {
    if (linkedPartner !== 'wellhub' && linkedPartner !== 'totalpass') return
    setError(null)
    startTransition(async () => {
      const result = await recordCheckin(studentId, linkedPartner as 'wellhub' | 'totalpass')
      if (result.error) {
        setError(result.error)
        return
      }
      setCheckinList((prev) => [
        {
          id: crypto.randomUUID(),
          partner: linkedPartner as 'wellhub' | 'totalpass',
          checkin_date: new Date().toISOString().slice(0, 10),
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
        type: pending,
        partnerId: declaredId,
        monthlyTarget: target,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setLinkedPartner(pending)
      setStudentTypeState(pending)
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
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="level">{cls.level.toUpperCase()}</Badge>
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

        {/* Enroll in new class */}
        {eligibleClasses.length > 0 && (
          <div className="flex gap-2 items-end">
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
                    {c.name} — {DAY_ABBR[c.day_of_week]} {formatTime(c.start_time)} (Nível {c.level})
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

          {dependentList.length === 0 ? (
            <p className="text-slate-500 text-sm mb-3">Nenhum dependente cadastrado.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {dependentList.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between px-4 py-2 bg-surface-card border border-surface-border rounded-xl"
                >
                  <span className="text-white text-sm">{d.full_name}</span>
                  <Badge variant="kids">KIDS · {d.level.toUpperCase()}</Badge>
                </li>
              ))}
            </ul>
          )}

          {/* Add dependent */}
          <div className="space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1">
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
          Créditos —{' '}
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
                  <p className="text-xs text-green-400 mt-0.5">
                    Ativo desde {new Date(activeSub.starts_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setShowCancelPlanDialog(true)}
                  className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50 shrink-0"
                >
                  Remover plano
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
          <div className="flex gap-2 items-end">
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
                    {p.name} — {p.classes_per_week}x/sem · R$ {(p.price_monthly / 100).toFixed(0)}/mês
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
            <div className="flex gap-2 mt-2">
              <Button onClick={handleConfirmPartner} disabled={isPending}>
                Confirmar
              </Button>
              <Button onClick={handleRejectPartner} disabled={isPending} variant="secondary">
                Recusar
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400">
            Tipo
            <select
              value={studentType}
              onChange={(e) =>
                setStudentTypeState(e.target.value as 'subscriber' | 'wellhub' | 'totalpass')
              }
              className="mt-1 block bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="subscriber">Mensalista (plano)</option>
              <option value="wellhub">Wellhub</option>
              <option value="totalpass">TotalPass</option>
            </select>
          </label>
          {(studentType === 'wellhub' || studentType === 'totalpass') && (
            <>
              <label className="text-xs text-slate-400">
                ID do parceiro
                <Input value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="mt-1" />
              </label>
              <label className="text-xs text-slate-400">
                Meta mensal
                <Input
                  type="number"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  className="mt-1 w-24"
                />
              </label>
            </>
          )}
          <Button onClick={handleSaveType} disabled={isPending} variant="secondary">
            Salvar tipo
          </Button>
        </div>

        {(linkedPartner === 'wellhub' || linkedPartner === 'totalpass') && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-300">
                {checkinsDone} / {monthlyTarget} check-ins no mês
                {checkinsDone < monthlyTarget && (
                  <span className="text-yellow-400"> · faltam {monthlyTarget - checkinsDone}</span>
                )}
                {checkinsDone > monthlyTarget && monthlyTarget > 0 && (
                  <span className="text-green-400"> · {checkinsDone - monthlyTarget} adiantado(s)</span>
                )}
              </p>
              <Button onClick={handleRecordCheckin} disabled={isPending}>
                Registrar check-in
              </Button>
            </div>
            <ul className="space-y-1">
              {checkinList.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between text-xs px-3 py-2 bg-surface-card border border-surface-border rounded-lg"
                >
                  <span className="text-white">
                    {new Date(c.checkin_date).toLocaleDateString('pt-BR')}
                    {c.session_id && <span className="text-green-400"> · presença em aula</span>}
                  </span>
                  <Badge variant={c.partner === 'wellhub' ? 'success' : 'warning'}>
                    {c.partner === 'wellhub' ? 'Wellhub' : 'TotalPass'}
                  </Badge>
                </li>
              ))}
              {checkinList.length === 0 && (
                <li className="text-slate-500 text-xs px-1">Nenhum check-in neste mês.</li>
              )}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
