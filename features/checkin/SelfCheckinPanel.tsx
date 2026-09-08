'use client'
// features/checkin/SelfCheckinPanel.tsx
// Confirmação de presença pelo aluno. Pede a localização no clique (o prompt do
// browser exige gesto do usuário) e chama a action nos DOIS caminhos: negar o
// GPS não impede confirmar, só manda a confirmação para revisão do professor.
//
// A janela é avaliada pelo relógio do CLIENTE — o servidor roda em UTC e não
// serve de referência para "abre às 18h", mesma razão do SpotlightRow.

import { useEffect, useState, useTransition } from 'react'
import { Check, Clock, MapPin, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  formatDistance,
  isAccurateEnough,
  pickBetterReading,
  canRetrySelfCheckin,
  GEO_SETTLE_MS,
} from '@/lib/checkin/selfCheckin'
import {
  confirmSelfAttendance,
  type ClientGeoError,
} from '@/features/checkin/selfCheckinActions'
import type { SelfCheckinView } from '@/features/checkin/selfCheckinQueries'

interface Props {
  sessionId: string
  view: SelfCheckinView
  /** 'card' na home, 'inline' dentro da ficha da aula. */
  variant?: 'card' | 'inline'
  className?: string
  /** Avisa quem envolve o painel (ex.: o popup automático) que o status mudou. */
  onStatusChange?: (status: 'validated' | 'pending') => void
}

type Reading =
  | { latitude: number; longitude: number; accuracyM: number }
  | { geoError: ClientGeoError }

/**
 * Lê a localização esperando o sinal MELHORAR, e não a primeira resposta.
 *
 * `getCurrentPosition` devolvia o primeiro fix disponível — que no celular
 * quase sempre é o de rede (wifi/torre), com precisão de centenas de metros a
 * quilômetros. Era isso que fazia o aluno DENTRO da quadra cair como pendente:
 * a distância era medida a partir de um ponto que não é onde ele está.
 *
 * Com `watchPosition`, cada atualização é comparada e fica a mais precisa;
 * assim que a precisão fica boa (`isAccurateEnough`) devolve na hora — em
 * quadra aberta isso costuma ser 2–4s. Se em `GEO_SETTLE_MS` nenhuma leitura
 * ficou boa, manda a melhor que apareceu: pendente com uma leitura ruim ainda é
 * melhor que pendente sem leitura nenhuma, e o `slack` de precisão do servidor
 * ainda pode salvar.
 *
 * Nunca rejeita: o motivo da falha faz parte do resultado.
 */
function readPosition(): Promise<Reading> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ geoError: 'unsupported' })
  }

  return new Promise((resolve) => {
    let best: { latitude: number; longitude: number; accuracyM: number } | null = null
    let done = false
    let watchId: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    function finish(reading: Reading) {
      if (done) return
      done = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (timer !== null) clearTimeout(timer)
      resolve(reading)
    }

    // Teto de tempo: o aluno está de pé na quadra esperando o botão responder.
    timer = setTimeout(() => finish(best ?? { geoError: 'timeout' }), GEO_SETTLE_MS)

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        best = pickBetterReading(best, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        })
        if (isAccurateEnough(best.accuracyM)) finish(best)
      },
      (err) => {
        // Erro depois de já ter uma leitura boa não descarta o que temos.
        if (best) {
          finish(best)
          return
        }
        const geoError: ClientGeoError =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        finish({ geoError })
      },
      { enableHighAccuracy: true, timeout: GEO_SETTLE_MS, maximumAge: 0 },
    )
  })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function SelfCheckinPanel({
  sessionId,
  view,
  variant = 'inline',
  className,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState(view.mine?.status ?? null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const [isPending, startTransition] = useTransition()

  // O relógio só existe no cliente: renderizar antes da montagem geraria
  // divergência de hidratação entre o horário do servidor e o do aluno.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null
  if (view.partnerCovered) {
    return (
      <Shell variant={variant} className={className}>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          Presença confirmada pelo check-in do parceiro
        </p>
      </Shell>
    )
  }

  if (status === 'validated') {
    return (
      <Shell variant={variant} className={className}>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
          <Check className="h-4 w-4" />
          Presença confirmada
        </p>
      </Shell>
    )
  }

  if (status === 'rejected') {
    return (
      <Shell variant={variant} className={className}>
        <p className="text-sm text-slate-300">
          O professor não validou esta confirmação. Fale com ele na quadra.
        </p>
      </Shell>
    )
  }

  const opensAt = new Date(view.opensAt).getTime()
  const closesAt = new Date(view.closesAt).getTime()
  const windowOpen = now >= opensAt && now <= closesAt

  if (status === 'pending') {
    // Nova tentativa: o servidor SOBE pendente → validada quando a leitura
    // nova bate (confirmSelfAttendance §7). Antes esta tela era um beco sem
    // saída — quem confirmou com o GPS ainda frio ficava dependendo do
    // professor mesmo estando na quadra, sem nada para fazer a respeito.
    const canRetry = windowOpen && canRetrySelfCheckin(view.mine?.geoError ?? null)
    return (
      <Shell variant={variant} className={className}>
        <p className="text-sm font-semibold text-amber-300">Presença enviada</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {canRetry
            ? 'Não deu para conferir sua localização. Se você já está na quadra, tente de novo.'
            : 'Não deu para conferir sua localização. O professor valida na chamada.'}
        </p>
        {canRetry && (
          <>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              loading={locating || isPending}
              disabled={locating || isPending}
              onClick={handleConfirm}
            >
              {locating ? 'Localizando…' : 'Tentar de novo'}
            </Button>
            {feedback && (
              <p
                role="status"
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
          </>
        )}
      </Shell>
    )
  }

  if (now > closesAt) return null

  if (now < opensAt) {
    return (
      <Shell variant={variant} className={className}>
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="h-3.5 w-3.5" />
          Confirmação de presença abre às {timeLabel(view.opensAt)}
        </p>
      </Shell>
    )
  }

  function handleConfirm() {
    setFeedback(null)
    setLocating(true)
    readPosition().then((reading) => {
      setLocating(false)
      startTransition(async () => {
        const result = await confirmSelfAttendance({ sessionId, ...reading })
        if (result.error) {
          setFeedback({ kind: 'erro', text: result.error })
          return
        }
        const finalStatus = result.status ?? 'pending'
        setStatus(finalStatus)
        onStatusChange?.(finalStatus)
        setFeedback(
          result.status === 'validated'
            ? { kind: 'ok', text: 'Presença confirmada!' }
            : {
                kind: 'ok',
                text:
                  result.distanceM != null
                    ? `Você está a ${formatDistance(result.distanceM)} da academia. O professor vai validar.`
                    : 'Presença enviada. O professor vai validar na chamada.',
              },
        )
      })
    })
  }

  const busy = locating || isPending

  return (
    <Shell variant={variant} className={className}>
      <Button
        variant="primary"
        className="w-full"
        loading={busy}
        disabled={busy}
        onClick={handleConfirm}
      >
        {locating ? 'Localizando…' : 'Confirmar presença'}
      </Button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
        <MapPin className="h-3 w-3" />
        Confirmamos que você está na academia. Sem GPS, o professor valida.
      </p>
      {feedback && (
        <p
          role="status"
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
    </Shell>
  )
}

function Shell({
  variant,
  className,
  children,
}: {
  variant: 'card' | 'inline'
  className?: string
  children: React.ReactNode
}) {
  if (variant === 'inline') return <div className={className}>{children}</div>
  return (
    <div
      className={
        'rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center ' + (className ?? '')
      }
    >
      {children}
    </div>
  )
}
