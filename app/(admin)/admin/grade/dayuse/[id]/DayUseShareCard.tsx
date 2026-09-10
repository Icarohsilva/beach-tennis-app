'use client'
// app/(admin)/admin/grade/dayuse/[id]/DayUseShareCard.tsx
// O que o admin usa para divulgar: capa, link e a mensagem pronta de WhatsApp.
//
// A mensagem sai de `dayUseShareMessage` — a mesma que a página pública usa.
// Duas versões do convite divergiriam no preço, que é o dado que faz a pessoa
// aparecer ou não.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { buildWhatsAppShareUrl } from '@/lib/utils/whatsappLink'
import { updateDayUseCover } from '@/features/dayuse/actions'

export function DayUseShareCard({
  slotId,
  shareUrl,
  shareMessage,
  coverImageUrl,
}: {
  slotId: string
  shareUrl: string
  shareMessage: string
  coverImageUrl: string | null
}) {
  const router = useRouter()
  const [cover, setCover] = useState(coverImageUrl)
  const [copied, setCopied] = useState<'link' | 'texto' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function copy(what: 'link' | 'texto') {
    const value = what === 'link' ? shareUrl : shareMessage
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(what)
        setTimeout(() => setCopied(null), 2000)
      },
      () => window.prompt('Copie:', value),
    )
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const supabase = createClient()
      // Extensão pelo MIME, não pelo nome do arquivo (que é controlável).
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]
      if (!ext) { setError('Envie JPG, PNG ou WEBP.'); return }
      const path = `${crypto.randomUUID()}.${ext}`
      const { error: upErr } = await supabase.storage.from('dayuse-images').upload(path, file)
      if (upErr) { setError('Erro no upload da imagem.'); return }
      const { data: urlData } = supabase.storage.from('dayuse-images').getPublicUrl(path)
      const r = await updateDayUseCover(slotId, urlData.publicUrl)
      if (r.error) { setError(r.error); return }
      setCover(urlData.publicUrl)
      router.refresh()
    })
  }

  return (
    <Card className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Divulgação
      </p>

      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt="Capa do day use"
          className="h-40 w-full rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-surface-border text-xs text-slate-500">
          Sem capa — o link vai sem imagem
        </div>
      )}

      <label className="inline-block cursor-pointer">
        <span
          className={`inline-block rounded-lg border border-surface-border bg-surface px-3 py-2 text-xs text-slate-300 transition-colors hover:border-brand-500 ${isPending ? 'opacity-60' : ''}`}
        >
          {isPending ? 'Enviando...' : cover ? '🖼️ Trocar capa' : '🖼️ Adicionar capa'}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFile}
        />
      </label>

      <div className="rounded-lg border border-surface-border bg-surface px-3 py-2">
        <p className="text-xs text-slate-400">Link público</p>
        <p className="mt-0.5 break-all font-mono text-xs text-white">{shareUrl}</p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface px-3 py-2">
        <p className="text-xs text-slate-400">Mensagem pronta</p>
        <p className="mt-0.5 whitespace-pre-line text-xs text-slate-300">{shareMessage}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={buildWhatsAppShareUrl(shareMessage)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center rounded-lg bg-green-600 px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          Enviar no WhatsApp
        </a>
        <Button variant="secondary" size="sm" onClick={() => copy('link')}>
          {copied === 'link' ? 'Link copiado!' : 'Copiar link'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => copy('texto')}>
          {copied === 'texto' ? 'Texto copiado!' : 'Copiar mensagem'}
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </Card>
  )
}
