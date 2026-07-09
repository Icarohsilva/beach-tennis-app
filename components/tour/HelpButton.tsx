'use client'

import { useState } from 'react'
import { HelpCircle, PlayCircle, MessageCircleQuestion, MessageSquarePlus, BookOpen } from 'lucide-react'
import type { TourVariant } from '@/lib/tour/autostart'
import { FaqModal } from './FaqModal'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'

export function HelpButton({
  variant,
  className,
  inline = false,
}: {
  variant: TourVariant
  className?: string
  inline?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [faqOpen, setFaqOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  function replay() {
    setMenuOpen(false)
    window.dispatchEvent(new CustomEvent('tour:replay'))
  }

  const wrapperClass = inline ? 'relative' : 'fixed z-50 ' + (className ?? 'bottom-24 right-4')
  const menuPosClass = inline ? 'top-full mt-2' : 'bottom-full mb-2'

  return (
    <>
      <div className={wrapperClass}>
        <button
          data-tour="tour-help-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Central de Ajuda"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-card border border-surface-border text-brand-500 shadow-lg hover:bg-surface-border transition-colors"
        >
          <HelpCircle className="h-5 w-5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div
              className={
                'absolute right-0 z-50 w-56 rounded-xl border border-surface-border bg-surface-card shadow-lg overflow-hidden ' +
                menuPosClass
              }
            >
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
              <a
                href={`/ajuda/${variant === 'aluno' ? 'aluno' : 'academia'}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors border-t border-surface-border"
              >
                <BookOpen className="h-4 w-4 text-brand-500" />
                Documentação
              </a>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  setFeedbackOpen(true)
                }}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-surface-border transition-colors border-t border-surface-border"
              >
                <MessageSquarePlus className="h-4 w-4 text-brand-500" />
                Enviar feedback
              </button>
            </div>
          </>
        )}
      </div>
      {faqOpen && <FaqModal variant={variant} onClose={() => setFaqOpen(false)} />}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </>
  )
}
