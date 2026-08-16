// features/home/RulesModal.tsx
'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { RuleSection } from '@/lib/aulas/classRules'

/**
 * Todas as regras do sistema, num modal — mesma mecânica de `SessionModal.tsx`:
 * `createPortal`, Esc para fechar, toque fora fecha, e a rolagem do fundo trava
 * no `<html>` **e** no `<body>` (em mobile o scroller costuma ser o `<html>`,
 * travar só o body deixa o dash rolar por trás).
 */
export function RulesModal({
  sections,
  onClose,
}: {
  sections: RuleSection[]
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
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
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overscroll-contain p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="glass reveal relative max-h-[85vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-white/10 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="rules-modal-title" className="text-lg font-extrabold text-white">
            Regras do sistema
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          {sections.map((section) => (
            <div key={section.id}>
              <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                {section.title}
              </p>
              <ul className="space-y-2">
                {section.items.map((item, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-slate-200">{item.text}</span>
                    {item.detail && (
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {item.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
