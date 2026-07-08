'use client'
// components/feedback/FeedbackModal.tsx
import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { submitFeedback } from '@/features/feedback/actions'

type Category = 'bug' | 'elogio' | 'ideia'

const OPTIONS: { value: Category; label: string; emoji: string }[] = [
  { value: 'bug', label: 'Bug', emoji: '🐞' },
  { value: 'elogio', label: 'Elogio', emoji: '💛' },
  { value: 'ideia', label: 'Ideia', emoji: '💡' },
]

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<Category>('bug')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (message.trim().length < 5) {
      setError('Descreva com pelo menos 5 caracteres.')
      return
    }
    setLoading(true)
    const fd = new FormData()
    fd.set('category', category)
    fd.set('message', message.trim())
    if (file) fd.set('image', file)
    const res = await submitFeedback(fd)
    setLoading(false)
    if (!res.ok) {
      setError(res.error ?? 'Não foi possível enviar. Tente novamente.')
      return
    }
    setDone(true)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface-card border border-surface-border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">Enviar feedback</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <p className="text-emerald-400 text-sm font-semibold">Recebemos seu feedback. Obrigado!</p>
            <Button className="mt-4" onClick={onClose}>Fechar</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  className={
                    'flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-semibold transition-colors ' +
                    (category === opt.value
                      ? 'border-brand-500 bg-brand-600/15 text-white'
                      : 'border-surface-border text-slate-400 hover:text-white')
                  }
                >
                  <span className="text-xl">{opt.emoji}</span>
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Descrição</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder="Conte o que aconteceu, o que gostou ou o que sugere..."
                className="w-full rounded-lg bg-surface border border-surface-border px-3 py-2 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-slate-300">Imagem (opcional)</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-surface-border file:px-3 file:py-1.5 file:text-slate-200"
              />
              {file && <p className="text-[11px] text-slate-500 truncate">{file.name}</p>}
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" loading={loading} size="lg" className="w-full">
              Enviar
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
