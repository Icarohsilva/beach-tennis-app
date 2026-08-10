'use client'
// features/home/SelfCheckinModal.tsx
// Popup automático de confirmação de presença: abre sozinho quando o aluno
// loga (aterrissa em /home) e alguma aula dele está com a janela de
// confirmação aberta e ele ainda não mandou nada pra ela.
//
// O aluno pode estar em MAIS de uma aula na mesma janela (turmas seguidas, ou
// matrícula em mais de uma turma no mesmo horário) — por isso é um único modal
// listando TODAS as elegíveis, cada uma com sua própria ação de confirmar ou
// dispensar, em vez de um modal por aula.
//
// Mesmos padrões de portal/acessibilidade de features/home/SessionModal.tsx.
// A escolha das aulas é do CLIENTE, pelo relógio do aluno — mesma razão do
// SelfCheckinCard e do SpotlightRow.

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

/** Depois de confirmar, dá tempo do aluno ler o feedback antes de sumir da lista. */
const AUTO_CLOSE_DELAY_MS = 1500

export function SelfCheckinModal({ candidates }: { candidates: SelfCheckinCandidate[] }) {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  // Sessões já resolvidas NESTA montagem (confirmadas ou dispensadas) — some da
  // lista na hora, sem esperar o próximo tick do relógio bater com o
  // localStorage (dismissSelfCheckin grava com Date.now() real; o `now` do
  // estado só anda a cada 30s, e comparar os dois direto poderia achar que o
  // registro é "do futuro" e ignorá-lo).
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Elegíveis: janela aberta, não cobertas pelo parceiro, o aluno ainda não
  // mandou nenhuma confirmação (mine === null — pending/rejected já tem
  // registro e não deve reabrir o popup, só o card discreto continua ali) e
  // não foram resolvidas nesta montagem nem dispensadas em sessão anterior.
  const eligible =
    mounted && now !== null
      ? candidates
          .filter((c) => {
            if (c.view.partnerCovered) return false
            if (c.view.mine !== null) return false
            if (resolvedIds.has(c.sessionId)) return false
            if (isSelfCheckinDismissed(c.sessionId, now)) return false
            const opensAt = new Date(c.view.opensAt).getTime()
            const closesAt = new Date(c.view.closesAt).getTime()
            return now >= opensAt && now <= closesAt
          })
          .sort((a, b) => new Date(a.view.closesAt).getTime() - new Date(b.view.closesAt).getTime())
      : []

  const shouldShow = eligible.length > 0

  function resolve(sessionId: string) {
    dismissSelfCheckin(sessionId, Date.now())
    setResolvedIds((prev) => new Set(prev).add(sessionId))
  }

  function handleDismissAll() {
    eligible.forEach((c) => dismissSelfCheckin(c.sessionId, Date.now()))
    setResolvedIds((prev) => {
      const next = new Set(prev)
      eligible.forEach((c) => next.add(c.sessionId))
      return next
    })
  }

  function handleStatusChange(sessionId: string) {
    setTimeout(() => resolve(sessionId), AUTO_CLOSE_DELAY_MS)
  }

  // Fecha no Esc e trava a rolagem do fundo, igual SessionModal. O hook em si
  // é chamado sempre — só o corpo do efeito é condicional ao popup estar
  // visível, o que respeita as regras de hooks (nada de retorno antes dele).
  useEffect(() => {
    if (!shouldShow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismissAll()
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
  }, [shouldShow])

  if (!shouldShow) return null

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
        onClick={handleDismissAll}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="self-checkin-modal-title" className="text-base font-extrabold text-white">
              Confirme sua presença
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {eligible.length > 1
                ? `Você tem ${eligible.length} aulas agora. Diga se vai em cada uma.`
                : 'Sua aula está começando.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismissAll}
            aria-label="Agora não"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ul className="mt-4 divide-y divide-white/10">
          {eligible.map((c) => (
            <li key={c.sessionId} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {c.className}{' '}
                  <span className="font-normal text-slate-400">
                    · {formatTime(c.start)}–{formatTime(c.end)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => resolve(c.sessionId)}
                  aria-label={`Agora não para ${c.className}`}
                  className="shrink-0 text-xs text-slate-400 underline underline-offset-2 hover:text-slate-300"
                >
                  Agora não
                </button>
              </div>
              <div className="mt-2">
                <SelfCheckinPanel
                  sessionId={c.sessionId}
                  view={c.view}
                  variant="inline"
                  onStatusChange={() => handleStatusChange(c.sessionId)}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
