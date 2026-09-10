'use client'
// features/home/DayUseModal.tsx
// A ficha do day use na agenda do aluno — irmã de SessionModal.
//
// Antes daqui, tocar num day use na agenda levava para a LISTA
// (`/agendar/dayuse`): o aluno perdia o contexto do dia e tinha de achar de
// novo o horário que acabou de tocar.
//
// O que este modal NÃO faz é reimplementar pagamento: reservar chama a mesma
// `bookDayUse` da página pública, e o PIX manual renderiza o mesmo
// `DayUsePixPanel`. Uma segunda via de cobrança divergiria da primeira no
// primeiro ajuste — e divergência em cobrança é dinheiro errado.
import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { X, Clock, MapPin, Users } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatDate, formatTime } from '@/lib/utils/dateHelpers'
import { sportEmoji, sportLabel } from '@/lib/arenas/sports'
import {
  DAY_USE_KIND_LABEL,
  dayUseKindHint,
  formatDayUsePrice,
} from '@/lib/dayuse/dayUseKind'
import { cancelNoticeForStudent } from '@/lib/dayuse/refundRules'
import { resolveDayUseCta } from '@/lib/dayuse/publicPage'
import { formatWalletCents, splitWithWallet } from '@/lib/wallet/wallet'
import { bookDayUse, cancelDayUseBooking } from '@/features/dayuse/actions'
import { DayUsePixPanel } from '@/app/(public)/d/[id]/DayUsePixPanel'
import type { DayUseDetail } from './calendarActions'

export function DayUseModal({
  detail,
  onClose,
}: {
  detail: DayUseDetail
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** Chave PIX devolvida pela reserva, para o painel aparecer sem recarregar. */
  const [pix, setPix] = useState<{ bookingId: string; key: string; owner: string | null } | null>(null)

  const { slot, priceCents, walletCents, occupied, attendees, mine } = detail
  const split = splitWithWallet(priceCents, walletCents)

  const cta = resolveDayUseCta({
    date: slot.date,
    end_time: slot.end_time,
    capacity: slot.capacity,
    occupied,
    myStatus: mine?.status ?? null,
    myPaymentMethod: mine?.paymentMethod ?? null,
    signedIn: true,
    priceCents,
    now: new Date(),
  })

  // Painel de PIX: ou a reserva já existe pendente por PIX manual, ou acabou de
  // ser criada nesta interação.
  const pixPanel = pix
    ? { bookingId: pix.bookingId, key: pix.key, owner: pix.owner, hasReceipt: false }
    : mine?.paymentMethod === 'pix_manual' && mine.status === 'pending_payment' && detail.pixKey
      ? { bookingId: mine.id, key: detail.pixKey, owner: detail.pixOwner, hasReceipt: mine.hasReceipt }
      : null

  function handleBook() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await bookDayUse(slot.id)
      if (r.error) { setError(r.error); return }
      if (r.initPoint) {
        window.location.href = r.initPoint
        return
      }
      if (r.pixKey && r.bookingId) {
        setPix({ bookingId: r.bookingId, key: r.pixKey, owner: r.pixOwner ?? null })
        setMessage('Vaga segurada. Pague por PIX e envie o comprovante.')
        router.refresh()
        return
      }
      setMessage(
        r.paidWithWalletCents
          ? `Reservado com seu crédito (${formatWalletCents(r.paidWithWalletCents)}).`
          : 'Reservado!',
      )
      router.refresh()
    })
  }

  function handleCancel() {
    if (!mine) return
    const notice = cancelNoticeForStudent({
      date: slot.date,
      start_time: slot.start_time,
      bookedAtIso: mine.bookedAt,
      nowIso: new Date().toISOString(),
      paidCents: priceCents,
      windowHours: detail.refundWindowHours,
    })
    if (!confirm(`Cancelar sua reserva?\n\n${notice}`)) return
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const r = await cancelDayUseBooking(mine.id)
      if (r.error) { setError(r.error); return }
      setMessage(
        r.refundDue
          ? 'Reserva cancelada. Seu estorno está registrado — escolha PIX ou crédito em Financeiro.'
          : `Reserva cancelada.${r.refundNote ? ` ${r.refundNote}` : ''}`,
      )
      router.refresh()
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-surface-border bg-surface-card p-5 pb-safe sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">
              Day use
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-white first-letter:uppercase">
              {slot.sport
                ? `${sportEmoji(slot.sport)} ${sportLabel(slot.sport)}`
                : formatDate(slot.date, "EEEE, dd 'de' MMMM")}
            </h2>
            {slot.sport && (
              <p className="text-xs text-slate-400 first-letter:uppercase">
                {formatDate(slot.date, "EEEE, dd 'de' MMMM")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-full p-1 text-slate-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="default">{DAY_USE_KIND_LABEL[slot.kind]}</Badge>
          <span className="text-lg font-bold text-white">{formatDayUsePrice(priceCents)}</span>
          {priceCents > 0 && <span className="text-xs text-slate-500">por pessoa</span>}
        </div>
        <p className="mt-1 text-xs text-slate-400">{dayUseKindHint(slot.kind)}</p>

        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {formatTime(slot.start_time)} às {formatTime(slot.end_time)}
          </li>
          <li className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            {occupied}/{slot.capacity} {slot.kind === 'open' ? 'pessoas' : 'vagas ocupadas'}
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
            Espaço {slot.court}
          </li>
        </ul>

        {slot.notes && <p className="mt-2 text-sm text-slate-400">{slot.notes}</p>}

        <div className="mt-4 space-y-2">
          {cta.actionable ? (
            <>
              <Button size="lg" className="w-full" disabled={isPending} onClick={handleBook}>
                {isPending ? 'Reservando...' : cta.label}
              </Button>
              {split.walletCents > 0 && (
                <p className="text-center text-xs text-green-400">
                  {split.gatewayCents === 0
                    ? `Pago com seu crédito de ${formatWalletCents(split.walletCents)} — sem cartão.`
                    : `${formatWalletCents(split.walletCents)} do seu crédito + ${formatWalletCents(split.gatewayCents)}.`}
                </p>
              )}
            </>
          ) : (
            <p
              className={
                cta.state === 'booked' || cta.state === 'pending'
                  ? 'text-center text-sm font-semibold text-green-400'
                  : 'text-center text-sm font-semibold text-slate-300'
              }
            >
              {cta.label}
            </p>
          )}
          <p className="text-center text-xs text-slate-500">{cta.note}</p>

          {mine && mine.status === 'confirmed' && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleCancel}
              className="block w-full text-center text-xs text-red-400 hover:text-red-300"
            >
              {isPending ? 'Cancelando...' : 'Cancelar minha reserva'}
            </button>
          )}
        </div>

        {pixPanel && (
          <div className="mt-4">
            <DayUsePixPanel
              bookingId={pixPanel.bookingId}
              amountCents={priceCents}
              pixKey={pixPanel.key}
              pixOwner={pixPanel.owner}
              hasReceipt={pixPanel.hasReceipt}
              refundPixKey={mine?.refundPixKey ?? null}
              refundPixOwner={mine?.refundPixOwner ?? null}
            />
          </div>
        )}

        {attendees.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Quem já vai
            </p>
            <p className="mt-1 text-sm text-slate-300">{attendees.join(' · ')}</p>
          </div>
        )}

        <div className="mt-4 text-center">
          <Link
            href={`/d/${slot.id}`}
            className="text-xs text-brand-400 hover:text-brand-300"
          >
            Abrir página do day use (para compartilhar)
          </Link>
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
        {message && <p className="mt-3 text-center text-xs text-green-400">{message}</p>}
      </div>
    </div>,
    document.body,
  )
}
