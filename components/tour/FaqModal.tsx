'use client'

import { X } from 'lucide-react'
import { getFaqs } from '@/lib/tour/faqs'
import type { TourVariant } from '@/lib/tour/autostart'

export function FaqModal({
  variant,
  onClose,
}: {
  variant: TourVariant
  onClose: () => void
}) {
  const faqs = getFaqs(variant)
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[80vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-card border border-surface-border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Perguntas frequentes</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2">
          {faqs.map((f, i) => (
            <details key={i} className="rounded-lg border border-surface-border bg-surface px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-white">{f.q}</summary>
              <p className="mt-2 text-sm text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  )
}
