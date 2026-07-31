'use client'
// app/(dashboard)/video/VideoClient.tsx

import { SectionHeader } from '@/components/ui/SectionHeader'
import { Card } from '@/components/ui/Card'

interface VideoClientProps {
  videoFeedUrl: string | null
}

export function VideoClient({ videoFeedUrl }: VideoClientProps) {
  const hasUrl = !!videoFeedUrl

  return (
    <div className="relative min-h-full pb-24">
      <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
        <SectionHeader title="Vídeo" />
      </div>

      <div className="px-4 py-4 space-y-3">
        {!hasUrl ? (
          <Card>
            <p className="text-sm text-slate-300">
              Vídeos ainda não configurados. Peça ao administrador da academia para configurar
              em Configurações.
            </p>
          </Card>
        ) : (
          <>
            <a
              href={videoFeedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-brand-500 hover:text-brand-400 transition-colors"
            >
              Abrir em nova aba →
            </a>
            {/* allow-scripts + allow-same-origin juntos: necessário pro site de vídeos manter
                sessão de login (cookies/localStorage). Aceitável aqui pois a URL só é definida
                por um admin da própria academia, nunca por conteúdo de terceiros/usuário. */}
            <iframe
              src={videoFeedUrl}
              className="w-full h-[75vh] rounded-xl border border-surface-border bg-surface-card"
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
              title="Vídeos das quadras"
            />
          </>
        )}
      </div>
    </div>
  )
}
