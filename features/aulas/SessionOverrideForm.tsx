'use client'
// features/aulas/SessionOverrideForm.tsx
// Editar UMA data da grade: remarcar, trocar de quadra, mudar a lotação, cancelar.
//
// O formulário trabalha com "vazio = herda a turma". Por isso os campos começam
// vazios quando não há override e o placeholder mostra o valor da turma: assim o
// professor vê o que vale hoje sem que o app grave um override igual ao padrão —
// e se a turma mudar depois, a data acompanha, que é o comportamento esperado de
// quem não mexeu em nada.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { updateSessionOverride, setSessionCancelled } from './adminActions'
import { hasOverride } from '@/lib/aulas/sessionOverride'

interface Props {
  sessionId: string
  sessionDate: string
  status: string
  cancelledReason: string | null
  /** Quantos alunos já estão nesta aula — a lotação nova é comparada com isto. */
  booked: number
  current: {
    start_time: string | null
    end_time: string | null
    court: number | null
    max_students: number | null
  }
  classDefaults: {
    start_time: string
    end_time: string
    court: number | null
    max_students: number
  }
}

/** 'HH:MM:SS' do banco para o 'HH:MM' que <input type="time"> espera. */
function toInputTime(value: string | null): string {
  return value ? value.slice(0, 5) : ''
}

/** E de volta: o Postgres aceita 'HH:MM', mas gravar sempre no mesmo formato
 *  evita comparação de string desencontrada em qualquer lugar que compare horas. */
function toDbTime(value: string): string | null {
  return value ? `${value}:00` : null
}

export function SessionOverrideForm({
  sessionId,
  status,
  cancelledReason,
  booked,
  current,
  classDefaults,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'aviso' | 'erro'; text: string } | null>(
    null,
  )

  const [startTime, setStartTime] = useState(toInputTime(current.start_time))
  const [endTime, setEndTime] = useState(toInputTime(current.end_time))
  const [court, setCourt] = useState(current.court?.toString() ?? '')
  const [maxStudents, setMaxStudents] = useState(current.max_students?.toString() ?? '')
  const [reason, setReason] = useState(cancelledReason ?? '')

  const cancelled = status === 'cancelled'
  const completed = status === 'completed'
  const alterada = hasOverride(current)

  function save() {
    setFeedback(null)
    startTransition(async () => {
      const result = await updateSessionOverride(sessionId, {
        start_time: toDbTime(startTime),
        end_time: toDbTime(endTime),
        court: court.trim() === '' ? null : Number(court),
        max_students: maxStudents.trim() === '' ? null : Number(maxStudents),
      })
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      setFeedback(
        result.warning
          ? { kind: 'aviso', text: result.warning }
          : { kind: 'ok', text: 'Aula desta data atualizada.' },
      )
      router.refresh()
    })
  }

  function reset() {
    setStartTime('')
    setEndTime('')
    setCourt('')
    setMaxStudents('')
    setFeedback(null)
    startTransition(async () => {
      const result = await updateSessionOverride(sessionId, {
        start_time: null,
        end_time: null,
        court: null,
        max_students: null,
      })
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      setFeedback({ kind: 'ok', text: 'Esta data voltou a seguir a turma.' })
      router.refresh()
    })
  }

  function toggleCancelled() {
    setFeedback(null)
    startTransition(async () => {
      const result = await setSessionCancelled(sessionId, !cancelled, reason)
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      router.refresh()
    })
  }

  // Aula encerrada tem chamada feita: mudar horário ou lotação depois reescreveria
  // um fato passado. A tela diz isso em vez de oferecer botões que vão falhar.
  if (completed) return null

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="flex flex-col gap-2 xs:flex-row xs:items-center xs:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            Esta data
            {alterada && (
              <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                alterada
              </span>
            )}
            {cancelled && (
              <span className="ml-2 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-300">
                cancelada
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Muda só este dia. A turma e as próximas semanas seguem como estão.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs font-semibold text-brand-500 underline underline-offset-2 hover:text-brand-400"
        >
          {open ? 'Fechar' : 'Editar esta data'}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-surface-border pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Início</label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder={classDefaults.start_time.slice(0, 5)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Fim</label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder={classDefaults.end_time.slice(0, 5)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Quadra</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
                placeholder={classDefaults.court?.toString() ?? 'da turma'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">
                Lotação {booked > 0 && <span className="text-slate-500">({booked} já dentro)</span>}
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                value={maxStudents}
                onChange={(e) => setMaxStudents(e.target.value)}
                placeholder={classDefaults.max_students.toString()}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Campo em branco segue o valor da turma ({classDefaults.start_time.slice(0, 5)}–
            {classDefaults.end_time.slice(0, 5)}, {classDefaults.max_students} alunos).
          </p>

          <div className="flex flex-col gap-2 xs:flex-row">
            <Button onClick={save} loading={pending} disabled={pending} className="w-full xs:w-auto">
              Salvar esta data
            </Button>
            {alterada && (
              <Button
                variant="secondary"
                onClick={reset}
                disabled={pending}
                className="w-full xs:w-auto"
              >
                Voltar ao padrão da turma
              </Button>
            )}
          </div>

          <div className="border-t border-surface-border pt-3">
            {!cancelled && (
              <div className="mb-2">
                <label className="mb-1 block text-xs text-slate-400">
                  Motivo do cancelamento (vai no aviso ao aluno)
                </label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex.: chuva forte, quadra interditada"
                />
              </div>
            )}
            <button
              type="button"
              onClick={toggleCancelled}
              disabled={pending}
              className={
                'text-xs font-semibold underline underline-offset-2 disabled:opacity-50 ' +
                (cancelled
                  ? 'text-emerald-400 hover:text-emerald-300'
                  : 'text-red-400 hover:text-red-300')
              }
            >
              {cancelled ? 'Reabrir esta aula' : 'Cancelar esta aula'}
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Cancelar tira a aula da agenda do aluno. Ninguém leva falta nem perde
              crédito, e reabrir devolve tudo como estava.
            </p>
          </div>

          {feedback && (
            <p
              className={
                'rounded-lg px-3 py-2 text-xs ' +
                (feedback.kind === 'ok'
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : feedback.kind === 'aviso'
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'border border-red-500/30 bg-red-500/10 text-red-300')
              }
            >
              {feedback.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
