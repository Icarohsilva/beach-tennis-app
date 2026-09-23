'use client'
// app/(admin)/admin/torneios/[id]/CopyPaymentLinkButton.tsx
// Copia o link pessoal de pagamento (/p/<token>) de UM lado da inscrição.
//
// A cobrança pelo WhatsApp só abre quando a pessoa tem telefone. Sem este
// botão, quem se cadastrou sem número ficava sem nenhum jeito de receber o link
// direto — e o admin acabava mandando a chave PIX solta, sem valor nem desconto.
import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export function CopyPaymentLinkButton({ url, label = 'Copiar link de pagamento' }: { url: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setState('copied')
      setTimeout(() => setState('idle'), 2500)
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button type="button" variant="secondary" size="sm" onClick={copy}>
        {state === 'copied' ? '✓ Link copiado' : `🔗 ${label}`}
      </Button>
      {state === 'failed' && (
        <p className="break-all text-xs text-slate-400">Copie à mão: {url}</p>
      )}
    </div>
  )
}
