'use client'
// app/(admin)/admin/wellhub/WellhubStudentRow.tsx
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { OccupancyBar } from '@/components/ui/OccupancyBar'
import {
  settleMissedCheckin,
  settleAllMissedCheckins,
  waiveMissedCheckin,
  chargeMissedCheckins,
} from '@/features/checkin/missedCheckinActions'
import type { NotificationChannel } from '@/lib/notifications/dispatch'
import type { CheckinPartner, MissedCheckinStatus } from '@/types'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

const PARTNER_LABEL: Record<CheckinPartner, string> = {
  wellhub: 'Wellhub',
  totalpass: 'TotalPass',
}

const STATUS_LABEL: Record<MissedCheckinStatus, string> = {
  open: 'Em aberto',
  paid: 'Pago',
  waived: 'Perdoado',
}

const SETTLE_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'maquininha', label: 'Maquininha' },
  { value: 'outro', label: 'Outro' },
]

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: 'inapp', label: 'No app' },
  { value: 'push', label: 'Push' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

const SELECT_CLS =
  'bg-surface border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export interface WellhubPendencyItem {
  id: string
  sessionDate: string
  amount: number
  status: MissedCheckinStatus
  className: string
}

export interface WellhubStudentRowProps {
  studentId: string
  fullName: string
  partner: CheckinPartner
  checkinsDone: number
  checkinTarget: number
  openCount: number
  openAmount: number
  blocked: boolean
  /** Quantas pendências ainda cabem antes de bloquear. null = bloqueio desligado. */
  untilBlock: number | null
  pendencies: WellhubPendencyItem[]
  /** Link wa.me já com a mensagem e as datas. null quando não há telefone. */
  whatsappUrl: string | null
}

export function WellhubStudentRow(props: WellhubStudentRowProps) {
  const {
    studentId, fullName, partner, checkinsDone, checkinTarget,
    openCount, openAmount, blocked, untilBlock, pendencies, whatsappUrl,
  } = props

  const [expanded, setExpanded] = useState(false)
  const [method, setMethod] = useState('pix')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [charging, setCharging] = useState(false)
  const [channels, setChannels] = useState<NotificationChannel[]>(['inapp', 'push'])
  const [pending, start] = useTransition()

  function run(fn: () => Promise<{ error?: string }>, okMsg?: string) {
    setErr(null)
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) setErr(r.error)
      else if (okMsg) setMsg(okMsg)
    })
  }

  function handleWaive(pendencyId: string) {
    const note = window.prompt('Motivo do perdão (atestado, chuva, erro de marcação…):')
    if (note === null) return
    if (note.trim().length === 0) {
      setErr('Escreva o motivo do perdão.')
      return
    }
    run(() => waiveMissedCheckin(pendencyId, note), 'Pendência perdoada.')
  }

  function toggleChannel(c: NotificationChannel) {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-white font-medium truncate">{fullName}</p>
            <Badge variant={partner === 'wellhub' ? 'success' : 'warning'}>
              {PARTNER_LABEL[partner]}
            </Badge>
            {blocked ? (
              <Badge variant="danger">🔒 Bloqueado</Badge>
            ) : openCount > 0 ? (
              <Badge variant="warning">
                {openCount} pendência{openCount !== 1 ? 's' : ''}
              </Badge>
            ) : (
              <Badge variant="success">Em dia</Badge>
            )}
          </div>

          <div className="mt-2 max-w-xs">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Check-ins no mês</span>
              <span className="text-slate-300">
                {checkinsDone} / {checkinTarget}
              </span>
            </div>
            <OccupancyBar booked={checkinsDone} capacity={Math.max(checkinTarget, 1)} />
          </div>

          {openCount > 0 && (
            <p className="text-xs text-slate-400 mt-2">
              {openAmount > 0 ? `${BRL.format(openAmount)} em aberto · ` : ''}
              {blocked
                ? 'já bloqueado'
                : untilBlock !== null
                  ? `bloqueia com ${untilBlock} a mais`
                  : 'bloqueio desligado'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Link direto pro WhatsApp do aluno, mensagem já com as datas. Um clique
              por aluno de propósito: navegador não abre várias abas de uma vez. */}
          {whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-green-600/40 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20"
            >
              WhatsApp
            </a>
          ) : (
            <span
              title="Aluno sem telefone cadastrado"
              className="rounded-lg border border-surface-border px-3 py-1.5 text-xs text-slate-500"
            >
              Sem telefone
            </span>
          )}

          {openCount > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setCharging((v) => !v)}>
              Notificar
            </Button>
          )}

          {pendencies.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-brand-400 hover:text-brand-300 underline"
            >
              {expanded ? 'Fechar' : `Ver ${pendencies.length}`}
            </button>
          )}
        </div>
      </div>

      {charging && (
        <div className="mt-3 border-t border-surface-border pt-3">
          <div className="flex flex-wrap gap-3">
            {CHANNELS.map((c) => (
              <label key={c.value} className="flex items-center gap-1 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={channels.includes(c.value)}
                  onChange={() => toggleChannel(c.value)}
                  className="w-3.5 h-3.5 accent-brand-500"
                />
                {c.label}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={pending}
              disabled={channels.length === 0}
              onClick={() =>
                run(() => chargeMissedCheckins(studentId, channels), 'Cobrança enviada.')
              }
            >
              Enviar cobrança
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCharging(false)} disabled={pending}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-surface-border pt-3">
          {openCount > 1 && (
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={SELECT_CLS}
              >
                {SETTLE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                loading={pending}
                onClick={() =>
                  run(() => settleAllMissedCheckins(studentId, method), 'Pendências quitadas.')
                }
              >
                Quitar todas ({openCount})
              </Button>
            </div>
          )}

          {pendencies.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs text-white">
                  {fmtDate(p.sessionDate)} · {p.className}
                </p>
                <p className="text-xs text-slate-400">
                  {p.amount > 0 ? BRL.format(p.amount) : 'sem valor'} · {STATUS_LABEL[p.status]}
                </p>
              </div>
              {p.status === 'open' && (
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className={SELECT_CLS}
                  >
                    {SETTLE_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={pending}
                    onClick={() => run(() => settleMissedCheckin(p.id, method), 'Baixa registrada.')}
                  >
                    Dar baixa
                  </Button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleWaive(p.id)}
                    className="text-xs text-slate-400 hover:text-white underline disabled:opacity-50"
                  >
                    Perdoar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
      {msg && <p className="text-xs text-green-400 mt-2">{msg}</p>}
    </Card>
  )
}
