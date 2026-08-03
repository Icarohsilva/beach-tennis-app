'use client'
// features/home/SelfCheckinCard.tsx
// Atalho de confirmação de presença na primeira dobra da home: o aluno abre o
// app na quadra e a ação precisa estar ali, não a dois toques de distância.
//
// A escolha da aula é do CLIENTE, pelo relógio do aluno — o servidor roda em
// UTC e escolheria a aula errada (mesma razão do NextClassSpotlight).

import { useEffect, useState } from 'react'
import { formatTime } from '@/lib/utils/dateHelpers'
import { SelfCheckinPanel } from '@/features/checkin/SelfCheckinPanel'
import type { SelfCheckinView } from '@/features/checkin/selfCheckinQueries'

export interface SelfCheckinCandidate {
  sessionId: string
  className: string
  /** HH:MM[:SS] */
  start: string
  end: string
  view: SelfCheckinView
}

export function SelfCheckinCard({ candidates }: { candidates: SelfCheckinCandidate[] }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (now === null) return null

  // Janela aberta agora; havendo mais de uma, a que fecha primeiro.
  const open = candidates
    .filter((c) => {
      if (c.view.partnerCovered) return false
      const opensAt = new Date(c.view.opensAt).getTime()
      const closesAt = new Date(c.view.closesAt).getTime()
      return now >= opensAt && now <= closesAt
    })
    .sort(
      (a, b) => new Date(a.view.closesAt).getTime() - new Date(b.view.closesAt).getTime(),
    )[0]

  if (!open) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Confirmar presença
      </p>
      <p className="mt-1 text-sm font-semibold text-white">
        {open.className}{' '}
        <span className="font-normal text-slate-400">
            · {formatTime(open.start)}–{formatTime(open.end)}
        </span>
      </p>
      <div className="mt-3">
        <SelfCheckinPanel sessionId={open.sessionId} view={open.view} variant="inline" />
      </div>
    </div>
  )
}
