'use client'
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  markDebtPaid,
  markAllDebtsPaid,
  approveDebtReceipt,
  rejectDebtReceipt,
} from '@/features/financeiro/debtActions'
import { ChargeButton } from './ChargeButton'
import { formatDate } from '@/lib/utils/dateHelpers'

const METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'maquininha', label: 'Maquininha' },
  { value: 'outro', label: 'Outro' },
]

const SELECT_CLS =
  'bg-surface border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500'

export interface DebtItem {
  id: string
  amount: number
  createdAt: string
  receiptUrl: string | null
  sessionDate: string | null
  /** URL assinada (bucket privado) quando há comprovante. */
  receiptSignedUrl: string | null
}

export interface DebtorRowProps {
  studentId: string
  fullName: string
  total: number
  count: number
  isBlocked: boolean
  awaitingReview: number
  debts: DebtItem[]
}

function fmt(amount: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)
}
// formatDate, não `new Date(...)`: `sessionDate` é data pura (yyyy-MM-dd), lida
// como meia-noite UTC e exibida em BRT voltava um dia. `formatDate` preserva o dia
// do calendário e mantém o parse normal para timestamptz (createdAt).
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return formatDate(iso)
}

export function DebtorRow(props: DebtorRowProps) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [allMethod, setAllMethod] = useState('dinheiro')
  const [pending, start] = useTransition()

  function run(fn: () => Promise<{ error?: string }>) {
    setErr(null)
    start(async () => {
      const r = await fn()
      if (r.error) setErr(r.error)
    })
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <button className="text-left" onClick={() => setOpen((o) => !o)}>
          <p className="text-sm font-medium text-white">{props.fullName}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {props.count} {props.count === 1 ? 'aula' : 'aulas'} · {fmt(props.total)}
          </p>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {props.awaitingReview > 0 && <Badge variant="warning">Conferir comprovante</Badge>}
          {props.isBlocked ? <Badge variant="danger">Bloqueado</Badge> : <Badge variant="default">Em aberto</Badge>}
        </div>
      </div>

      {err && <p className="text-xs text-red-400 mt-2">{err}</p>}

      {open && (
        <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
          {props.debts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <div>
                <p className="text-white">{fmt(d.amount)}</p>
                <p className="text-xs text-slate-400">Aula {fmtDate(d.sessionDate)} · lançada {fmtDate(d.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                {d.receiptSignedUrl && (
                  <a
                    href={d.receiptSignedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-brand-500"
                  >
                    Ver comprovante
                  </a>
                )}
                {d.receiptUrl ? (
                  <>
                    <Button variant="primary" size="sm" disabled={pending}
                      onClick={() => run(() => approveDebtReceipt(d.id))}>
                      Aprovar
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending}
                      onClick={() => {
                        const reason = window.prompt('Motivo da recusa (o aluno recebe):', '') ?? ''
                        run(() => rejectDebtReceipt(d.id, reason))
                      }}>
                      Recusar
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" disabled={pending}
                    onClick={() => run(() => markDebtPaid(d.id, 'dinheiro'))}>
                    Dar baixa
                  </Button>
                )}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 border-t border-surface-border pt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Quitar todas por</span>
              <select value={allMethod} onChange={(e) => setAllMethod(e.target.value)} className={SELECT_CLS}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <Button variant="secondary" size="sm" disabled={pending}
                onClick={() => run(() => markAllDebtsPaid(props.studentId, allMethod))}>
                Quitar todas
              </Button>
            </div>
            <ChargeButton studentId={props.studentId} />
          </div>
        </div>
      )}
    </Card>
  )
}
