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
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { bookDayUse, cancelDayUseBooking } from '@/features/dayuse/actions'
import { DayUsePixPanel } from '@/app/(public)/d/[id]/DayUsePixPanel'
import { loadDayUseDetail, type DayUseDetail } from './calendarActions'

export function DayUseModal({
  detail: initialDetail,
  onClose,
}: {
  detail: DayUseDetail
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()
  /**
   * A ficha vive em estado LOCAL e é rebuscada depois de reservar/cancelar.
   *
   * `router.refresh()` sozinho não resolvia: o modal recebeu a ficha por
   * parâmetro de uma server action, então a árvore recarregava e o modal
   * continuava com o retrato antigo — quem cancelava seguia lendo "Você está
   * nesta lista", clicava de novo e ouvia "já cancelei".
   */
  const [detail, setDetail] = useState(initialDetail)

  const { slot, priceCents, walletCents, occupied, attendees, mine } = detail

  async function reload() {
    const fresh = await loadDayUseDetail(slot.id)
    if (fresh) setDetail(fresh)
    // A árvore também recarrega: a agenda por trás mostra ocupação e "sua
    // reserva", e ficaria velha depois de reservar.
    router.refresh()
  }
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

  // Painel de PIX: a ficha rebuscada já traz a reserva pendente, então não há
  // estado paralelo para o que acabou de ser criado.
  const pixPanel =
    mine?.paymentMethod === 'pix_manual' && mine.status === 'pending_payment' && detail.pixKey
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
      if (r.pixKey) {
        setMessage('Vaga segurada. Pague por PIX e envie o comprovante.')
      } else if (r.payOnSiteCents) {
        setMessage(
          `Vaga garantida. Pague ${formatWalletCents(r.payOnSiteCents)} na arena.`,
        )
      } else if (r.paidWithWalletCents) {
        setMessage(`Reservado com seu crédito (${formatWalletCents(r.paidWithWalletCents)}).`)
      } else {
        setMessage('Reservado!')
      }
      await reload()
    })
  }

  async function handleCancel() {
    if (!mine) return
    const { ok } = await confirm({
      title: 'Cancelar sua reserva?',
      message: cancelNoticeForStudent({
        date: slot.date,
        start_time: slot.start_time,
        bookedAtIso: mine.bookedAt,
        nowIso: new Date().toISOString(),
        paidCents: priceCents,
        windowHours: detail.refundWindowHours,
      }),
      confirmLabel: 'Cancelar reserva',
      cancelLabel: 'Manter',
      destructive: true,
    })
    if (!ok) return
    setError(null)
    setMessage(null)
    const bookingId = mine.id
    startTransition(async () => {
      const r = await cancelDayUseBooking(bookingId)
      if (r.error) { setError(r.error); return }
      setMessage(
        r.refundDue
          ? 'Reserva cancelada. Seu estorno está registrado — escolha PIX ou crédito em Financeiro.'
          : `Reserva cancelada.${r.refundNote ? ` ${r.refundNote}` : ''}`,
      )
      await reload()
    })
  }

  return createPortal(
    // Mesmo casco de SessionModal: overlay com blur atrás, `glass`, cantos 3xl
    // e sombra. Antes daqui este modal era um painel de fundo chapado subindo
    // por baixo, e não parecia do mesmo app.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dayuse-modal-title"
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
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">
              Day use
            </p>
            <h2
              id="dayuse-modal-title"
              className="mt-0.5 text-lg font-extrabold text-white first-letter:uppercase"
            >
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
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={isPending}
              onClick={handleCancel}
            >
              {isPending ? 'Cancelando...' : 'Cancelar minha reserva'}
            </Button>
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

        <div className="mt-4">
          <Link href={`/d/${slot.id}`} className="block">
            <Button variant="secondary" size="sm" className="w-full">
              Abrir página do day use
            </Button>
          </Link>
        </div>

        {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
        {message && <p className="mt-3 text-center text-xs text-green-400">{message}</p>}
      </div>

      {dialog}
    </div>,
    document.body,
  )
}
