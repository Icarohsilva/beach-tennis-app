// features/home/SessionModal.tsx
'use client'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X, Users, Clock, CalendarDays, Check } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import { formatDate } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import { bookSession, cancelBooking, skipEnrollmentSession, skipEnrollmentForSession } from '@/features/aulas/actions'
import { joinWaitlist, leaveWaitlist } from '@/features/aulas/waitlistActions'
import {
  bookSessionForDependent,
  cancelBookingForDependent,
  joinWaitlistForDependent,
  leaveWaitlistForDependent,
} from '@/features/aulas/guardianActions'
import { SelfCheckinPanel } from '@/features/checkin/SelfCheckinPanel'
import type { AgendaSession, GuardianOption } from './agendaTypes'
import type { PayWith } from '@/types'

/** Primeiro nome: a ficha fala com o pai sobre o filho, não sobre um cadastro. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** Um dos dois cartões de forma de pagamento. */
function PaymentChoice({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'min-w-0 flex-1 rounded-2xl border p-2.5 text-left transition-colors ' +
        (active
          ? 'border-brand-500/50 bg-brand-500/10'
          : 'border-white/10 bg-white/[0.03] hover:border-white/20')
      }
    >
      <span
        className={
          'block text-xs font-bold ' + (active ? 'text-brand-300' : 'text-slate-200')
        }
      >
        {label}
      </span>
      <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>
    </button>
  )
}

/**
 * Ficha da aula sobre a agenda: horário, quem já está confirmado e a ação de
 * entrar ou sair — sem tirar o aluno da home.
 */
export function SessionModal({
  session,
  onClose,
  isToday,
}: {
  session: AgendaSession
  onClose: () => void
  isToday: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  // Forma de pagamento escolhida. `undefined` = não escolheu, e o servidor
  // aplica a precedência de sempre (plano antes de crédito). Só vira pergunta
  // quando as duas formas existem de fato.
  const [payWith, setPayWith] = useState<PayWith | undefined>(undefined)

  useEffect(() => setMounted(true), [])

  // Fecha no Esc e trava a rolagem do fundo enquanto a ficha está aberta.
  // Em mobile o scroller costuma ser o <html>, não o <body> — travar só o body
  // deixava o dash rolar por trás. Travamos os dois.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const root = document.documentElement
    const prevRoot = root.style.overflow
    const prevBody = document.body.style.overflow
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      root.style.overflow = prevRoot
      document.body.style.overflow = prevBody
    }
  }, [onClose])

  if (!mounted) return null

  const isFull = session.booked >= session.capacity
  const spotsLeft = Math.max(session.capacity - session.booked, 0)

  function run(action: () => Promise<{ error?: string }>, successText: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setFeedback({ kind: 'erro', text: result.error })
      else setFeedback({ kind: 'ok', text: successText })
    })
  }

  function handleJoin() {
    run(() => bookSession(session.id, payWith), 'Presença confirmada!')
  }

  // ── Responsável agindo pelo dependente ────────────────────────────────────
  // O dependente não tem login: se o pai não puder entrar por ele daqui, a aula
  // do filho aparece na agenda sem nenhuma ação possível.
  // Sem `payWith`: a escolha "plano ou crédito" exibida acima é calculada com o
  // plano e o saldo do RESPONSÁVEL, e quem paga esta aula é o dependente, que tem
  // os seus. Aplicar a escolha do pai aqui gastaria crédito do filho por um botão
  // que falava do saldo do pai. Para o dependente vale a precedência normal.
  function handleDependentJoin(dep: GuardianOption) {
    run(
      () => bookSessionForDependent(session.id, dep.id),
      `${firstName(dep.name)} está na aula!`,
    )
  }

  function handleDependentLeave(dep: GuardianOption) {
    if (!dep.bookingId) return
    run(
      () => cancelBookingForDependent(dep.bookingId!),
      `${firstName(dep.name)} saiu da aula.`,
    )
  }

  function handleDependentJoinWaitlist(dep: GuardianOption) {
    setFeedback(null)
    startTransition(async () => {
      const result = await joinWaitlistForDependent(session.id, dep.id)
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      setFeedback({
        kind: 'ok',
        text: `${firstName(dep.name)} entrou na fila${result.position ? ` na ${result.position}ª posição` : ''}.`,
      })
    })
  }

  function handleDependentLeaveWaitlist(dep: GuardianOption) {
    if (!dep.waitlistEntryId) return
    run(
      () => leaveWaitlistForDependent(dep.waitlistEntryId!),
      `${firstName(dep.name)} saiu da fila.`,
    )
  }

  // Turma lotada: entra na fila daqui mesmo. Antes a ficha só dizia "entre pela
  // tela de agendar" e o aluno tinha que sair da home para conseguir. Toda a
  // validação (turma realmente cheia, já reservado, já na fila) é do servidor.
  function handleJoinWaitlist() {
    setFeedback(null)
    startTransition(async () => {
      const result = await joinWaitlist(session.id)
      if (result.error) {
        setFeedback({ kind: 'erro', text: result.error })
        return
      }
      setFeedback({
        kind: 'ok',
        text: `Você entrou na fila${result.position ? ` na ${result.position}ª posição` : ''}. Avisamos se abrir vaga. Quem entrar primeiro fica com ela.`,
      })
    })
  }

  function handleLeaveWaitlist() {
    if (!session.waitlistEntryId) return
    run(() => leaveWaitlist(session.waitlistEntryId!), 'Você saiu da fila de espera.')
  }

  function handleLeave() {
    // Aula fixa e aula avulsa saem por caminhos diferentes: a fixa devolve
    // crédito de reposição, a avulsa segue a janela de cancelamento.
    if (session.bookingId) {
      const leave = session.fromEnrollment
        ? () => skipEnrollmentSession(session.bookingId!)
        : () => cancelBooking(session.bookingId!)
      run(leave, 'Saída registrada.')
      return
    }
    run(() => skipEnrollmentForSession(session.id), 'Falta registrada para esta data.')
  }

  const isIn = session.mine || session.fixed

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-modal-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative max-h-[85vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="session-modal-title" className="truncate text-lg font-extrabold text-white">
                {session.className}
              </h2>
              {session.kids && <Badge variant="kids">KIDS</Badge>}
              {session.sport && (
                <span className="shrink-0 text-xs text-slate-400">
                  {sportEmoji(session.sport)} {sportLabel(session.sport)}
                </span>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              {isToday ? 'Hoje' : formatDate(session.date, "EEEE, d 'de' MMMM")}
              {session.cancelled ? (
                <span className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
                  Cancelada
                </span>
              ) : (
                session.rescheduled && (
                  <span className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                    Alterada
                  </span>
                )
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="shrink-0 text-center">
            <p className="text-xl font-extrabold leading-none text-white">
              {session.start.slice(0, 5)}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">até {session.end.slice(0, 5)}</p>
          </div>
          <div className="min-w-0 flex-1">
            {/* "6 de 8 confirmados" (~130px) contra o badge de vagas (~62px) em
                ~168px de espaço: os dois quebravam e o badge fragmentava. O texto
                encurta em tela estreita e o badge nunca encolhe. */}
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="whitespace-nowrap">
                  {session.booked} de {session.capacity}
                  <span className="hidden xs:inline"> confirmados</span>
                </span>
              </span>
              <span className="shrink-0">
                {isFull ? (
                  <Badge variant="danger">Lotada</Badge>
                ) : (
                  <Badge variant="success">
                    {spotsLeft} {spotsLeft === 1 ? 'vaga' : 'vagas'}
                  </Badge>
                )}
              </span>
            </div>
            <OccupancyBar booked={session.booked} capacity={session.capacity} className="mt-2" />
          </div>
        </div>

        {/* Aula cancelada: o aviso vem antes de tudo e nenhuma ação é oferecida.
            A aula continua na agenda de propósito — sumir sem deixar rastro era
            o que fazia o aluno descobrir na quadra. */}
        {session.cancelled && (
          <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm font-bold text-red-300">Esta aula foi cancelada</p>
            {session.cancelledReason && (
              <p className="mt-1 text-xs text-red-200/80">{session.cancelledReason}</p>
            )}
            <p className="mt-2 text-xs text-slate-300">
              Você não levou falta. Quem tinha usado crédito recebeu de volta, e a
              aula não conta na cota do seu plano.
            </p>
          </div>
        )}

        {/* Confirmação de presença: só para quem está na aula, e o próprio
            painel se esconde fora da janela. */}
        {!session.cancelled && isIn && session.selfCheckin && (
          <SelfCheckinPanel
            sessionId={session.id}
            view={session.selfCheckin}
            variant="card"
            className="mt-4"
          />
        )}

        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Users className="h-3.5 w-3.5" />
            Quem está na aula ({session.attendees.length})
          </p>
          {session.attendees.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">Ninguém confirmado ainda. Seja o primeiro.</p>
          ) : (
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {session.attendees.map((name, i) => (
                <li
                  key={`${name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-200"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-bold text-brand-300">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {session.waitlist.length > 0 && (
          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              Fila de espera ({session.waitlist.length})
            </p>
            <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
              {session.waitlist.map((name, i) => (
                <li
                  key={`wl-${name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-sm text-slate-300"
                >
                  {/* Número é ordem de chegada, não prioridade: a vaga fica com
                      quem entrar primeiro quando ela abre. */}
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] font-bold text-slate-400">
                    {i + 1}
                  </span>
                  <span className="truncate">{name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feedback && (
          <p
            role="status"
            className={
              'mt-4 rounded-lg px-3 py-2 text-xs ' +
              (feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'border border-red-500/30 bg-red-500/10 text-red-300')
            }
          >
            {feedback.text}
          </p>
        )}

        {/* Escolher com o que paga. Só aparece quando as duas formas existem de
            verdade: com uma só, perguntar é ruído. Crédito não gasta a cota do
            plano nem esbarra no teto diário — é aula comprada à parte. */}
        {session.canChoosePayment && !isIn && !session.kids && !session.cancelled && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Como quer usar esta aula
            </p>
            <div className="mt-2 flex gap-2">
              <PaymentChoice
                active={payWith !== 'credit'}
                onClick={() => setPayWith('plan')}
                label="Aula do plano"
                hint="Conta na sua cota"
              />
              <PaymentChoice
                active={payWith === 'credit'}
                onClick={() => setPayWith('credit')}
                label="1 crédito avulso"
                hint={
                  session.creditsBalance !== undefined
                    ? `Você tem ${session.creditsBalance}`
                    : 'Não conta na cota'
                }
              />
            </div>
          </div>
        )}

        {/* Turma kids: quem entra é o dependente. O adulto vê a aula (é a aula do
            filho dele, tem de estar na agenda), mas a ação é por criança. */}
        {session.kids && !session.cancelled && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Turma kids
            </p>
            {session.guardianOptions && session.guardianOptions.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {session.guardianOptions.map((dep) => (
                  <li key={dep.id} className="flex flex-col gap-2 xs:flex-row xs:items-center xs:justify-between">
                    <span className="min-w-0 truncate text-sm font-semibold text-white">
                      {dep.name}
                    </span>
                    <span className="shrink-0">
                      {dep.bookingId ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDependentLeave(dep)}
                          className="text-xs font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-50"
                        >
                          Tirar da aula
                        </button>
                      ) : dep.waitlistEntryId ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDependentLeaveWaitlist(dep)}
                          className="text-xs font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-50"
                        >
                          Sair da fila
                        </button>
                      ) : (
                        <Button
                          variant={isFull ? 'secondary' : 'primary'}
                          loading={isPending}
                          disabled={isPending}
                          onClick={() =>
                            isFull ? handleDependentJoinWaitlist(dep) : handleDependentJoin(dep)
                          }
                          className="w-full xs:w-auto"
                        >
                          {isFull ? 'Entrar na fila' : 'Colocar na aula'}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Turma exclusiva para alunos kids. Se você é responsável por
                alguma criança, cadastre o dependente no seu perfil para poder
                inscrevê-lo aqui.
              </p>
            )}
          </div>
        )}

        {/* O adulto não entra em turma kids: a ação abaixo é só para as turmas
            dele. Sem este corte a ficha ofereceria um botão que o servidor nega. */}
        <div className={session.kids || session.cancelled ? 'hidden' : 'mt-5'}>
          {isIn ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-300">
                <Check className="h-4 w-4" />
                {session.fixed && !session.mine ? 'Sua aula fixa' : 'Você está nesta aula'}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={handleLeave}
                className="text-xs font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-50"
              >
                Sair desta aula
              </button>
            </div>
          ) : isFull && session.waitlistEntryId ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-brand-300">
                  Você está na fila de espera
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleLeaveWaitlist}
                  className="text-xs font-semibold text-red-400 underline underline-offset-2 transition-colors hover:text-red-300 disabled:opacity-50"
                >
                  Sair da fila
                </button>
              </div>
              <p className="text-xs text-slate-400">
                Se alguém cancelar, avisamos todo mundo da fila. A vaga fica com
                quem entrar primeiro.
              </p>
            </div>
          ) : isFull ? (
            <div className="space-y-2">
              <Button
                variant="secondary"
                loading={isPending}
                disabled={isPending}
                onClick={handleJoinWaitlist}
                className="w-full"
              >
                Entrar na fila de espera
              </Button>
              <p className="text-center text-xs text-slate-400">
                Turma lotada. Se alguém cancelar, avisamos todo mundo da fila. A
                vaga fica com quem entrar primeiro.
              </p>
            </div>
          ) : session.waitlistEntryId ? (
            // Estava na fila e abriu vaga: a corrida está aberta para toda a
            // fila. Entrar aqui passa pelo agendamento normal e já tira da fila.
            <div className="space-y-2">
              <p className="text-center text-xs font-semibold text-brand-400">
                🔔 Vaga disponível! A vaga é de quem entrar primeiro.
              </p>
              <Button
                variant="primary"
                loading={isPending}
                disabled={isPending}
                onClick={handleJoin}
                className="w-full"
              >
                Entrar na aula
              </Button>
            </div>
          ) : (
            <Button
              variant="primary"
              loading={isPending}
              disabled={isPending}
              onClick={handleJoin}
              className="w-full"
            >
              Entrar na aula
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
