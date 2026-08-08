'use client'
// features/liga/MedalCelebration.tsx
// Comemoração das medalhas que o aluno ainda não viu (spec §Fase 2).
//
// O momento importa: a conquista aparece na primeira vez que ele abre a Liga depois de
// ganhar, não some sozinha e não vira uma linha a mais numa lista. É o instante em que
// ele mostra a tela para o amigo do lado.
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Share2 } from 'lucide-react'
import { markLigaMedalsSeen, shareLigaMedals } from './actions'
import { MedalIcon } from './MedalIcon'

export interface CelebratedMedal {
  id: string
  label: string
  description: string
  icon: string
  sportLabel: string | null
}

interface Props {
  medals: CelebratedMedal[]
}

export function MedalCelebration({ medals }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [pending, startTransition] = useTransition()
  const [sharing, setSharing] = useState(false)

  if (medals.length === 0 || dismissed) return null

  function handleDismiss() {
    // Fecha na hora e grava depois: a comemoração é enfeite, e travar a tela esperando
    // o servidor responder seria pior que reexibi-la numa falha de rede.
    setDismissed(true)
    startTransition(async () => {
      await markLigaMedalsSeen(medals.map((m) => m.id))
    })
  }

  function handleShare() {
    // Compartilhar já conta como visto: quem publicou a conquista viu a conquista.
    setSharing(true)
    startTransition(async () => {
      await shareLigaMedals(medals.map((m) => m.id))
      setDismissed(true)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-8 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-brand-500/40 bg-surface-card p-5 shadow-xl shadow-brand-900/40">
        <p className="text-center text-xs tracking-wide text-brand-500 mb-4">
          {medals.length === 1 ? 'MEDALHA CONQUISTADA' : `${medals.length} MEDALHAS CONQUISTADAS`}
        </p>

        <ul className="space-y-3 mb-5">
          {medals.map((medal, i) => (
            <li key={medal.id} className="flex items-center gap-3">
              <span
                className="medal-pop flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand-500/40 bg-gradient-to-br from-brand-600 to-brand-800"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <MedalIcon name={medal.icon} className="h-6 w-6 text-white" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{medal.label}</span>
                <span className="block text-xs text-slate-400">
                  {medal.description}
                  {medal.sportLabel ? ` · ${medal.sportLabel}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={handleDismiss}
            disabled={pending}
          >
            Boa!
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleShare}
            loading={sharing && pending}
          >
            <Share2 className="mr-1.5 h-4 w-4" />
            Compartilhar
          </Button>
        </div>
      </div>
    </div>
  )
}
