'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { deactivateDayUseSlot } from './actions'
import { DayUseBadges } from './DayUseBadges'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
  /** Preço da academia (slot → padrão), em centavos. */
  priceCents: number
  /** Pagamento na arena, sem cobrança online. */
  payOnSite?: boolean
}

export function DayUseSlotCard({ slot, bookingsCount, priceCents, payOnSite = false }: Props) {
  const [loading, setLoading] = useState(false)
  const { confirm, dialog } = useConfirm()
  const isFull = bookingsCount >= slot.capacity

  async function handleRemove() {
    // O texto muda para slot gerado por recorrência: a geração NÃO ressuscita
    // data removida (ver features/dayuse/generation.ts), e o admin precisa
    // saber que remover aqui não desliga a recorrência inteira.
    const linhas: string[] = []
    if (slot.recurrence_id) {
      linhas.push(
        'A recorrência continua ligada e as outras datas não mudam. Esta data não volta na geração automática.',
      )
    }
    // Quem tem reserva é avisado e quem pagou entra na fila de estorno: o admin
    // precisa saber disso ANTES de clicar, porque a partir daqui a academia
    // passa a DEVER dinheiro.
    if (bookingsCount > 0) {
      linhas.push(
        `${bookingsCount} reserva(s) serão canceladas, os alunos avisados e o estorno de quem pagou entra em Financeiro › Day use.`,
      )
    }
    const { ok } = await confirm({
      title: slot.recurrence_id ? 'Remover só esta data?' : 'Remover este day use?',
      message: linhas.join('\n'),
      confirmLabel: 'Remover',
      cancelLabel: 'Manter',
      destructive: true,
    })
    if (!ok) return
    setLoading(true)
    await deactivateDayUseSlot(slot.id)
  }

  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <DayUseBadges
          court={slot.court}
          sport={slot.sport}
          kind={slot.kind}
          priceCents={priceCents}
          payOnSite={payOnSite}
        />
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          {isFull
            ? <Badge variant="danger">Lotado</Badge>
            : <Badge variant="success">Disponível</Badge>
          }
          {slot.recurrence_id && <Badge variant="default">Recorrente</Badge>}
        </div>
        <p className="text-white text-sm font-medium">
          {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
        </p>
        {slot.notes && <p className="text-slate-400 text-xs mt-0.5 truncate">{slot.notes}</p>}
        <p className="text-slate-500 text-xs mt-1">
          {bookingsCount}/{slot.capacity} {slot.kind === 'open' ? 'pessoas' : 'reservas'}
        </p>
      </div>
      {/* Os dois na MESMA forma de botão, mudando só a cor. "Abrir" era texto
          solto ao lado de um botão vermelho — parecia outra coisa. */}
      <div className="flex shrink-0 flex-col items-stretch gap-2">
        <Link href={`/admin/grade/dayuse/${slot.id}`} className="block">
          <Button size="sm" className="w-full">Abrir</Button>
        </Link>
        <Button variant="danger" size="sm" disabled={loading} onClick={handleRemove}>
          {loading ? '...' : 'Remover'}
        </Button>
      </div>
      {dialog}
    </Card>
  )
}
