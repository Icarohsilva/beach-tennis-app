'use client'

import { useState } from 'react'
import { HelpCircle, PlayCircle, MessageCircleQuestion } from 'lucide-react'
import type { TourVariant } from '@/lib/tour/autostart'
import { FaqModal } from './FaqModal'

export function HelpButton({
  variant,
  className,
}: {
  variant: TourVariant
  className?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)

  function replay() {
    setMenuOpen(false)
    window.dispatchEvent(new CustomEvent('tour:replay'))
  }

  return (
    <>
      <div className={'fixed z-50 ' + (className ?? 'bottom-24 right-4')}>
        {menuOpen && (
          <div className="mb-2 w-56 rounded-xl border border-surface-border bg-surface-card shadow-lg overflow-hidden">
            <button
              onClick={replay}
              className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors"
            >
              <PlayCircle className="h-4 w-4 text-brand-500" />
              Ver tutorial novamente
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                setFaqOpen(true)
              }}
              className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors border-t border-surface-border"
            >
              <MessageCircleQuestion className="h-4 w-4 text-brand-500" />
              Perguntas frequentes
            </button>
          </div>
        )}
        <button
          data-tour="tour-help-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Central de Ajuda"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-card border border-surface-border text-brand-500 shadow-lg hover:bg-surface-border transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
      </div>
      {faqOpen && <FaqModal variant={variant} onClose={() => setFaqOpen(false)} />}
    </>
  )
}
