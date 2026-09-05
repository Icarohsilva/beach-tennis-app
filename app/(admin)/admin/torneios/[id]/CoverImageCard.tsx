'use client'
// app/(admin)/admin/torneios/[id]/CoverImageCard.tsx
// Card do admin com preview da imagem de capa + URL copiável.
import { useState, useTransition } from 'react'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { updateTournamentCover } from '@/features/torneios/actions'

interface CoverImageCardProps {
  tournamentId: string
  coverImageUrl: string | null
  shareUrl: string
}

export function CoverImageCard({ tournamentId, coverImageUrl, shareUrl }: CoverImageCardProps) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(coverImageUrl)
  const [copied, setCopied] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadError(null)
    startTransition(async () => {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('tournament-images')
        .upload(path, file)
      if (upErr) {
        setUploadError('Erro no upload da imagem.')
        return
      }
      const { data: urlData } = supabase.storage
        .from('tournament-images')
        .getPublicUrl(path)
      const newUrl = urlData.publicUrl
      const result = await updateTournamentCover(tournamentId, newUrl)
      if (result.error) {
        setUploadError(result.error)
        return
      }
      setCurrentUrl(newUrl)
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">🔗 Link público</p>

      {/* Preview da imagem */}
      <div
        className="relative w-full rounded-lg overflow-hidden mb-2"
        style={{
          height: 80,
          background: currentUrl ? undefined : 'linear-gradient(135deg,#1e3a5f,#f97316)',
        }}
      >
        {currentUrl ? (
          <img src={currentUrl} alt="Capa" className="w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-white/30 text-xs">
            Sem imagem de capa
          </span>
        )}
        <label className="absolute top-1.5 right-1.5 cursor-pointer">
          <span className="bg-black/60 text-white text-xs rounded px-2 py-1 hover:bg-black/80 transition-colors">
            {isPending ? '...' : 'Trocar'}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileChange}
            disabled={isPending}
          />
        </label>
      </div>

      {/* URL copiável.
          min-w-0 é o que falta para `truncate` valer num item flex: por
          padrão um filho flex não encolhe abaixo da largura do próprio
          conteúdo (min-width:auto), então um UUID de 36 caracteres em
          font-mono empurrava o card — e a página inteira — para além da
          tela em vez de truncar com reticências. */}
      <div className="flex gap-2 items-center">
        <span className="min-w-0 flex-1 truncate bg-surface border border-surface-border rounded-lg px-3 py-2 text-xs text-slate-500 font-mono">
          {shareUrl}
        </span>
        <button
          onClick={handleCopy}
          className="shrink-0 bg-brand-500 text-white rounded-lg px-3 py-2 text-xs font-semibold hover:bg-orange-400 transition-colors whitespace-nowrap"
        >
          {copied ? 'Copiado!' : 'Copiar'}
        </button>
      </div>

      {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
    </Card>
  )
}
