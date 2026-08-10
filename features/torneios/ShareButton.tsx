'use client'
// features/torneios/ShareButton.tsx
// Compartilha o torneio pelo link público (/t/[id]), que abre sem login.
//
// Divulgação de torneio amador acontece no grupo do WhatsApp, então o caminho
// certo é a folha de compartilhamento do próprio celular. Onde ela não existe
// (desktop), cai para copiar o link — nunca some do jeito silencioso.
import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

interface ShareButtonProps {
  /** Caminho público relativo, ex: /t/abc123. */
  path: string
  title: string
  /** O que está sendo compartilhado, para o leitor de tela: "torneio", "evento", "arena". */
  what?: string
}

export function ShareButton({ path, title, what = 'torneio' }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    // A origem só existe no cliente; montar a URL no servidor exigiria saber o
    // domínio da academia, que varia por white-label.
    const url = `${window.location.origin}${path}`

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // Cancelar a folha de compartilhamento rejeita a promise. Não é erro:
        // o aluno desistiu, e cair para "copiado" aqui seria mentira.
        return
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sem permissão de área de transferência não há o que fazer em silêncio.
      window.prompt('Copie o link do torneio:', url)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label="Compartilhar torneio"
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/30 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/50"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? 'Link copiado' : 'Compartilhar'}
    </button>
  )
}
