'use client'
// features/financeiro/PaymentHistory.tsx
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { Payment, PaymentStatus, PaymentTransactionType } from '@/types'

interface PaymentHistoryProps {
  payments: Payment[]
  pageSize?: number
}

const PAGE_SIZE = 10

function statusVariant(status: PaymentStatus): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'paid') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'danger'
  return 'default'
}

function statusLabel(status: PaymentStatus): string {
  const labels: Record<PaymentStatus, string> = {
    paid: 'Pago',
    pending: 'Pendente',
    failed: 'Falhou',
    refunded: 'Reembolsado',
  }
  return labels[status] ?? status
}

function typeLabel(type: PaymentTransactionType): string {
  const labels: Record<PaymentTransactionType, string> = {
    subscription: 'Assinatura',
    per_class: 'Avulso',
    trial: 'Aula Trial',
  }
  return labels[type] ?? type
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)
}

export function PaymentHistory({ payments, pageSize = PAGE_SIZE }: PaymentHistoryProps) {
  const [page, setPage] = useState(1)

  const total = payments.length
  const totalPages = Math.ceil(total / pageSize)
  const slice = payments.slice((page - 1) * pageSize, page * pageSize)

  if (total === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-400 text-center py-4">Nenhum pagamento encontrado.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {slice.map((payment) => (
        <Card key={payment.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{typeLabel(payment.type)}</span>
                <Badge variant={statusVariant(payment.status)}>
                  {statusLabel(payment.status)}
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {formatDate(payment.created_at)}
                {payment.paid_at && payment.status === 'paid' && (
                  <> · pago em {formatDate(payment.paid_at)}</>
                )}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold text-white">
              {formatAmount(payment.amount, payment.currency)}
            </span>
          </div>
        </Card>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-xs text-slate-400">
            {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próximo
          </Button>
        </div>
      )}
    </div>
  )
}
