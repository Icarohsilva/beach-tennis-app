'use client'
// app/(public)/d/[id]/ShareDayUse.tsx
// Compartilhar o day use: a folha nativa do celular (que é como a arena manda
// para o grupo) e um botão direto de WhatsApp, porque é lá que a captação
// acontece de fato — a pesquisa de arenas não mostrou nenhuma que divulgue day
// use por outro canal.
import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { buildWhatsAppShareUrl } from '@/lib/utils/whatsappLink'
import { Button } from '@/components/ui/Button'
import { WhatsAppButton } from '@/components/ui/WhatsAppButton'

export function ShareDayUse({ message }: { message: string }) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: message })
      } catch {
        // Cancelar a folha rejeita a promise: o usuário desistiu, não é erro.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copie o convite:', message)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" className="gap-1.5" onClick={handleShare}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
        {copied ? 'Convite copiado' : 'Compartilhar'}
      </Button>
      <WhatsAppButton href={buildWhatsAppShareUrl(message)}>
        Enviar no WhatsApp
      </WhatsAppButton>
    </div>
  )
}
