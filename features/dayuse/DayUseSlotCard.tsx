'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatTime } from '@/lib/utils/dateHelpers'
import { deactivateDayUseSlot } from './actions'
import { DayUseBadges } from './DayUseBadges'
import type { DayUseSlot } from '@/types'

interface Props {
  slot: DayUseSlot
  bookingsCount: number
  /** Preço PRETENDIDO pela academia (slot → padrão), em centavos. */
  priceCents: number
  /** Preço definido sem forma de cobrar — o card avisa em vez de dizer "Gratuito". */
  unchargeable?: boolean
}

export function DayUseSlotCard({ slot, bookingsCount, priceCents, unchargeable = false }: Props) {
  const [loading, setLoading] = useState(false)
  const isFull = bookingsCount >= slot.capacity

  async function handleRemove() {
    // O texto muda para slot gerado por recorrência: a geração NÃO ressuscita
    // data removida (ver features/dayuse/generation.ts), e o admin precisa
    // saber que remover aqui não desliga a recorrência inteira.
    const escopo = slot.recurrence_id
      ? 'Remover só esta data do day use recorrente?\n\nA recorrência continua ligada e as outras datas não mudam. Esta data não volta na geração automática.'
      : 'Remover este slot de day use?'
    // Quem tem reserva é avisado e quem pagou entra na fila de estorno: o admin
    // precisa saber disso ANTES de clicar, porque a partir daqui a academia
    // passa a DEVER dinheiro.
    const consequencia = bookingsCount > 0
      ? `\n\n${bookingsCount} reserva(s) serão canceladas, os alunos avisados e o estorno de quem pagou entra em Financeiro › Day use.`
      : ''
    const msg = `${escopo}${consequencia}`
    if (!confirm(msg)) return
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
          unchargeable={unchargeable}
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
      <div className="flex shrink-0 flex-col items-end gap-1">
        {/* A tela do day use é onde o admin vê quem está inscrito, confere
            comprovante e divulga o link. Antes daqui a lista só dava a
            contagem. */}
        <Link
          href={`/admin/grade/dayuse/${slot.id}`}
          className="text-xs font-semibold text-brand-400 hover:text-brand-300"
        >
          Abrir
        </Link>
        <Button variant="danger" size="sm" disabled={loading} onClick={handleRemove}>
          {loading ? '...' : 'Remover'}
        </Button>
      </div>
    </Card>
  )
}
