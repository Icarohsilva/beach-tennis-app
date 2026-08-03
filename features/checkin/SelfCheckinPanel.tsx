'use client'
// features/checkin/SelfCheckinPanel.tsx
// Confirmação de presença pelo aluno. Pede a localização no clique (o prompt do
// browser exige gesto do usuário) e chama a action nos DOIS caminhos: negar o
// GPS não impede confirmar, só manda a confirmação para revisão do professor.
//
// A janela é avaliada pelo relógio do CLIENTE — o servidor roda em UTC e não
// serve de referência para "abre às 18h", mesma razão do NextClassSpotlight.

import { useEffect, useState, useTransition } from 'react'
import { Check, Clock, MapPin, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatDistance } from '@/lib/checkin/selfCheckin'
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
}

type Reading =
  | { latitude: number; longitude: number; accuracyM: number }
  | { geoError: ClientGeoError }

/** Nunca rejeita: o motivo da falha faz parte do resultado. */
function readPosition(): Promise<Reading> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ geoError: 'unsupported' })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        }),
      (err) => {
        const geoError: ClientGeoError =
          err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable'
        resolve({ geoError })
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function SelfCheckinPanel({ sessionId, view, variant = 'inline', className }: Props) {
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

  if (status === 'pending') {
    return (
      <Shell variant={variant} className={className}>
        <p className="text-sm font-semibold text-amber-300">Presença enviada</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Não deu para conferir sua localização. O professor valida na chamada.
        </p>
      </Shell>
    )
  }

  const opensAt = new Date(view.opensAt).getTime()
  const closesAt = new Date(view.closesAt).getTime()

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
        setStatus(result.status ?? 'pending')
        setFeedback(
          result.status === 'validated'
            ? { kind: 'ok', text: 'Presença confirmada!' }
            : {
                kind: 'ok',
                text:
                  result.distanceM != null
                    ? `Você está a ${formatDistance(result.distanceM)} da academia — o professor vai validar.`
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
