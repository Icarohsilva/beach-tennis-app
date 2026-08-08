'use client'
// app/(dashboard)/liga/VideoBlock.tsx
// Vídeos das quadras dentro da Liga (spec 2026-07-31-video-cameras-iframe). Antes era
// a aba inteira; virou um bloco quando a Liga tomou o lugar dela no menu.
import { Card } from '@/components/ui/Card'

interface Props {
  videoFeedUrl: string | null
}

export function VideoBlock({ videoFeedUrl }: Props) {
  if (!videoFeedUrl) return null

  return (
    <Card>
      <p className="text-xs text-slate-400 tracking-wide mb-3">VÍDEOS DAS QUADRAS</p>
      <div className="rounded-xl border border-brand-600/40 bg-brand-600/10 p-3 space-y-2 mb-3">
        <p className="text-sm text-slate-200">
          Alguns sites de vídeo não aceitam login dentro do app. Se a tela abaixo não deixar
          entrar, abra em uma aba separada:
        </p>
        <a
          href={videoFeedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-600/25 transition-all hover:from-brand-500 hover:to-brand-600 active:scale-[0.98]"
        >
          Abrir em nova aba →
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Conteúdo do site de vídeos da academia, fora do controle do ArenaHub. Não compartilhe
        senhas de outros serviços aqui.
      </p>
      {/* allow-scripts + allow-same-origin: necessário pro site de vídeos manter sessão de
          login (cookies/localStorage). allow-forms: envio do formulário de login.
          allow-popups: alguns provedores abrem OAuth/2FA em popup. Aceitável pois a URL só
          é definida por um admin da própria academia, nunca por conteúdo de terceiros/usuário. */}
      <iframe
        src={videoFeedUrl}
        className="w-full h-[60vh] rounded-xl border border-surface-border bg-surface-card"
        sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
        title="Vídeos das quadras"
      />
    </Card>
  )
}
