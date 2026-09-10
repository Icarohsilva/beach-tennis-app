'use client'
// features/dayuse/RefundCard.tsx
// O estorno visto pelo ALUNO: quanto, em que estado, e as duas decisões que são
// dele — trocar PIX por crédito enquanto ninguém pagou, e confirmar quando o
// dinheiro cair.
//
// Usado em /financeiro (aluno da arena) e em /d/[id] (o avulso, que não tem
// /financeiro nem sino de notificação).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { formatDayUsePrice } from '@/lib/dayuse/dayUseKind'
import { canSwitchToCredit, refundStatusLabel } from '@/lib/dayuse/refundRules'
import {
  confirmRefundReceived,
  setRefundPixKey,
  switchRefundToCredit,
} from './refundActions'
import type { StudentRefund } from './refundQueries'

export function RefundCard({ refund }: { refund: StudentRefund }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState(!refund.pix_key)
  const [pixKey, setPixKey] = useState(refund.pix_key ?? '')
  const [pixOwner, setPixOwner] = useState(refund.pix_owner ?? '')

  const pendente = canSwitchToCredit(refund.status)

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setMessage(ok)
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-col gap-2 xs:flex-row xs:items-start xs:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {formatDayUsePrice(refund.amount_cents)}
          </p>
          {refund.slot && (
            <p className="mt-0.5 text-xs text-slate-400 first-letter:uppercase">
              Day use de {formatDate(refund.slot.date, "EEEE, dd/MM")} às{' '}
              {formatTime(refund.slot.start_time)}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-500">
            {refund.cause === 'arena_cancelou'
              ? 'A academia cancelou este horário.'
              : 'Você cancelou dentro do prazo.'}
          </p>
        </div>
        <div className="shrink-0">
          {refund.status === 'pendente' && <Badge variant="warning">Pendente</Badge>}
          {refund.status === 'pago' && <Badge variant="warning">Confirme</Badge>}
          {refund.status === 'confirmado' && <Badge variant="success">Confirmado</Badge>}
          {refund.status === 'creditado' && <Badge variant="success">Crédito</Badge>}
        </div>
      </div>

      <p className="text-xs text-slate-400">{refundStatusLabel(refund.status)}</p>

      {pendente && (
        <div className="space-y-3 border-t border-surface-border pt-3">
          {editingKey ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Informe a chave PIX para a academia enviar o valor.
              </p>
              <Input
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder="CPF, telefone, e-mail ou chave aleatória"
              />
              <Input
                value={pixOwner}
                onChange={(e) => setPixOwner(e.target.value)}
                placeholder="Nome do titular da conta"
              />
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => run(
                  () => setRefundPixKey(refund.id, pixKey, pixOwner),
                  'Chave salva. A academia já pode enviar o PIX.',
                )}
              >
                Salvar chave PIX
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 break-all text-xs text-slate-300">
                PIX: <span className="text-white">{refund.pix_key}</span>
                {refund.pix_owner && <span className="text-slate-500"> · {refund.pix_owner}</span>}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setEditingKey(true)}
              >
                Trocar
              </Button>
            </div>
          )}

          <div className="rounded-lg border border-surface-border bg-surface p-3">
            <p className="text-xs text-slate-300">
              Prefere não esperar o PIX? Você pode receber como{' '}
              <strong className="text-white">crédito no app</strong> e usar em outro day use,
              na compra de aulas avulsas ou em inscrição de torneio.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              disabled={isPending}
              onClick={() => run(
                () => switchRefundToCredit(refund.id),
                'Crédito adicionado ao seu saldo.',
              )}
            >
              Receber como crédito
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              A troca vale só enquanto o estorno está pendente.
            </p>
          </div>
        </div>
      )}

      {refund.status === 'pago' && (
        <div className="space-y-2 border-t border-surface-border pt-3">
          <p className="text-xs text-slate-300">
            A academia registrou o PIX. Confira na sua conta e confirme.
          </p>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => run(
              () => confirmRefundReceived(refund.id),
              'Obrigado! Estorno confirmado.',
            )}
          >
            Confirmar que recebi
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {message && <p className="text-xs text-green-400">{message}</p>}
    </Card>
  )
}
