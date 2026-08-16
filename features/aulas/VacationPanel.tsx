'use client'
// features/aulas/VacationPanel.tsx
// Férias: o painel do admin (marca direto, aprova, recusa) e o do aluno (pede,
// desiste). Um componente só, com `mode`, porque as duas telas mostram a MESMA
// lista de períodos — o que muda são as ações. Dois componentes divergiriam no
// primeiro ajuste de texto.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils/dateHelpers'
import {
  requestVacation,
  setVacationForStudent,
  approveVacation,
  rejectVacation,
  cancelVacation,
} from './vacationActions'
import type { VacationRow, VacationStatus } from './vacationQueries'

const STATUS_LABEL: Record<VacationStatus, string> = {
  pending: 'Aguardando',
  approved: 'Aprovada',
  rejected: 'Recusada',
  cancelled: 'Cancelada',
}

const STATUS_STYLE: Record<VacationStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-red-500/30 bg-red-500/10 text-red-300',
  cancelled: 'border-white/10 bg-white/[0.04] text-slate-400',
}

interface Props {
  /** 'admin' marca e responde; 'student' pede e desiste. */
  mode: 'admin' | 'student'
  /** Obrigatório no modo admin — de quem são as férias. */
  studentId?: string
  vacations: VacationRow[]
}

export function VacationPanel({ mode, studentId, vacations }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null)

  const ativos = vacations.filter((v) => v.status === 'pending' || v.status === 'approved')
  const historico = vacations.filter((v) => v.status === 'rejected' || v.status === 'cancelled')

  function run(action: () => Promise<{ error?: string }>, okText: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      setFeedback({ kind: 'ok', text: okText })
      setStartsOn('')
      setEndsOn('')
      setOpen(false)
      router.refresh()
    })
  }

  function submit() {
    if (!startsOn || !endsOn) {
      setFeedback({ kind: 'erro', text: 'Escolha a data de saída e a de volta.' })
      return
    }
    if (mode === 'admin') {
      if (!studentId) return
      run(
        () => setVacationForStudent(studentId, startsOn, endsOn),
        'Férias registradas. O aluno sai das aulas do período.',
      )
    } else {
      run(
        () => requestVacation(startsOn, endsOn),
        'Pedido enviado. A academia vai responder — até lá suas aulas seguem normais.',
      )
    }
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface-card p-4">
      <div className="flex flex-col gap-2 xs:flex-row xs:items-center xs:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Férias</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {mode === 'admin'
              ? 'O aluno sai das aulas geradas no período e não reserva sozinho. A mensalidade não é alterada.'
              : 'Vai viajar? Avise a academia. Aprovado o pedido, você sai das aulas do período sem levar falta — e a mensalidade segue igual.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs font-semibold text-brand-500 underline underline-offset-2 hover:text-brand-400"
        >
          {open ? 'Fechar' : mode === 'admin' ? 'Marcar férias' : 'Pedir férias'}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-surface-border pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Saída</label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Volta</label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Os dois dias entram nas férias: quem sai no dia 10 e volta no dia 20 não
            tem aula em nenhum dos dois.
          </p>
          <Button onClick={submit} loading={pending} disabled={pending} className="w-full xs:w-auto">
            {mode === 'admin' ? 'Registrar férias' : 'Enviar pedido'}
          </Button>
        </div>
      )}

      {feedback && (
        <p
          className={
            'mt-3 rounded-lg px-3 py-2 text-xs ' +
            (feedback.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300'
              : 'border border-red-500/30 bg-red-500/10 text-red-300')
          }
        >
          {feedback.text}
        </p>
      )}

      {ativos.length > 0 && (
        <ul className="mt-4 space-y-2">
          {ativos.map((v) => (
            <li
              key={v.id}
              className="flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 xs:flex-row xs:items-center xs:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm text-white">
                  {formatDate(v.startsOn)} a {formatDate(v.endsOn)}
                </p>
                <span
                  className={
                    'mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ' +
                    STATUS_STYLE[v.status]
                  }
                >
                  {STATUS_LABEL[v.status]}
                </span>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {mode === 'admin' && v.status === 'pending' && (
                  <>
                    <Button
                      loading={pending}
                      disabled={pending}
                      onClick={() => run(() => approveVacation(v.id), 'Férias aprovadas.')}
                    >
                      Aprovar
                    </Button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => rejectVacation(v.id), 'Pedido recusado.')}
                      className="text-xs font-semibold text-red-400 underline underline-offset-2 hover:text-red-300 disabled:opacity-50"
                    >
                      Recusar
                    </button>
                  </>
                )}
                {/* Cancelar vale para os dois: o aluno desiste do pedido, o admin
                    encerra férias já aprovadas quando o aluno volta antes. */}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => cancelVacation(v.id),
                      v.status === 'approved'
                        ? 'Férias encerradas. As aulas do período não voltam sozinhas — entre nas que quiser.'
                        : 'Pedido cancelado.',
                    )
                  }
                  className="text-xs font-semibold text-slate-400 underline underline-offset-2 hover:text-white disabled:opacity-50"
                >
                  {v.status === 'approved' ? 'Encerrar' : 'Cancelar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {ativos.length === 0 && !open && (
        <p className="mt-3 text-xs text-slate-500">Nenhum período de férias registrado.</p>
      )}

      {historico.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
            Histórico ({historico.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {historico.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  {formatDate(v.startsOn)} a {formatDate(v.endsOn)}
                </span>
                <span className="shrink-0">{STATUS_LABEL[v.status]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
