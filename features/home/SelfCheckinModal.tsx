'use client'
// features/home/SelfCheckinModal.tsx
// Popup automático de confirmação de presença: abre sozinho quando o aluno
// loga (aterrissa em /home) e alguma aula dele está com a janela de
// confirmação aberta e ele ainda não mandou nada pra ela.
//
// Mesmos padrões de portal/acessibilidade de features/home/SessionModal.tsx.
// A escolha da aula é do CLIENTE, pelo relógio do aluno — mesma razão do
// SelfCheckinCard e do NextClassSpotlight.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { formatTime } from '@/lib/utils/dateHelpers'
import { SelfCheckinPanel } from '@/features/checkin/SelfCheckinPanel'
import {
  isSelfCheckinDismissed,
  dismissSelfCheckin,
} from '@/lib/checkin/selfCheckinDismissStorage'
import type { SelfCheckinCandidate } from './SelfCheckinCard'

/** Depois de confirmar, dá tempo do aluno ler o feedback antes de fechar. */
const AUTO_CLOSE_DELAY_MS = 1500

export function SelfCheckinModal({ candidates }: { candidates: SelfCheckinCandidate[] }) {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Elegível: janela aberta, não coberta pelo parceiro, e o aluno ainda não
  // mandou nenhuma confirmação (mine === null) — pending/rejected já tem
  // registro e não deve reabrir o popup, só o card discreto continua ali.
  const open =
    mounted && now !== null
      ? candidates
          .filter((c) => {
            if (c.view.partnerCovered) return false
            if (c.view.mine !== null) return false
            const opensAt = new Date(c.view.opensAt).getTime()
            const closesAt = new Date(c.view.closesAt).getTime()
            return now >= opensAt && now <= closesAt
          })
          .sort(
            (a, b) => new Date(a.view.closesAt).getTime() - new Date(b.view.closesAt).getTime(),
          )[0] ?? null
      : null

  const shouldShow =
    !!open &&
    open.sessionId !== dismissedId &&
    !isSelfCheckinDismissed(open.sessionId, now ?? 0)

  function handleClose() {
    if (!open) return
    dismissSelfCheckin(open.sessionId, Date.now())
    setDismissedId(open.sessionId)
  }

  function handleStatusChange() {
    if (!open) return
    const sessionId = open.sessionId
    setClosing(true)
    setTimeout(() => {
      dismissSelfCheckin(sessionId, Date.now())
      setDismissedId(sessionId)
    }, AUTO_CLOSE_DELAY_MS)
  }

  // Fecha no Esc e trava a rolagem do fundo, igual SessionModal. O hook em si
  // é chamado sempre — só o corpo do efeito é condicional ao popup estar
  // visível, o que respeita as regras de hooks (nada de retorno antes dele).
  useEffect(() => {
    if (!shouldShow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    const root = document.documentElement
    const prevRoot = root.style.overflow
    const prevBody = document.body.style.overflow
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      root.style.overflow = prevRoot
      document.body.style.overflow = prevBody
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, open?.sessionId])

  if (!shouldShow || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-checkin-modal-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={closing ? undefined : handleClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="self-checkin-modal-title" className="text-base font-extrabold text-white">
              Confirme sua presença
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-400">
              {open.className} · {formatTime(open.start)}–{formatTime(open.end)}
            </p>
          </div>
          {!closing && (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Agora não"
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="mt-4">
          <SelfCheckinPanel
            sessionId={open.sessionId}
            view={open.view}
            variant="card"
            onStatusChange={handleStatusChange}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
