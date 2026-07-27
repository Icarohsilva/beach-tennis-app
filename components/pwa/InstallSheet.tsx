'use client'
// components/pwa/InstallSheet.tsx
// O convite para instalar o app. Três variantes, decididas por resolvePrompt:
// Android (prompt nativo), iOS (passo a passo) e iOS dentro de in-app browser
// (onde instalar é impossível — só resta mandar abrir no Safari).
import { useState } from 'react'
import Link from 'next/link'
import { X, Share, Compass, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PASSOS_TEXTO } from '@/lib/pwa/passosInstalacao'
import { IosInstallAnimation } from './IosInstallAnimation'

export type InstallSheetDecision = 'install-ios' | 'install-ios-inapp' | 'install-android'

export function InstallSheet({
  decision,
  manual,
  onDismiss,
  onInstall,
}: {
  decision: InstallSheetDecision
  manual: 'aluno' | 'academia'
  onDismiss: () => void
  onInstall: () => Promise<void>
}) {
  // O in-app browser não é um convite, é um beco sem saída: resolvePrompt ignora
  // a dispensa nesse estado. Mostrar X, "Agora não" ou fechar no fundo seria
  // mentir — a pessoa toca, nada acontece, e ela fica presa atrás do overlay.
  const dispensavel = decision !== 'install-ios-inapp'
  const [mostrandoPassos, setMostrandoPassos] = useState(false)
  const [instalando, setInstalando] = useState(false)
  const [linkCopiado, setLinkCopiado] = useState(false)

  async function instalar() {
    setInstalando(true)
    try {
      await onInstall()
    } finally {
      // O prompt nativo é uma superfície que pode lançar (segunda chamada,
      // navegador bloqueando). Sem o finally, o botão trava em "carregando"
      // para sempre e a pessoa não consegue nem tentar de novo.
      setInstalando(false)
    }
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setLinkCopiado(true)
    } catch {
      // Clipboard barrado (contexto não seguro, permissão negada): o endereço
      // já está visível na barra do navegador, então não há o que fazer.
    }
  }

  return (
    // z-[75] fica acima do CookieBanner (z-[70]), que também é ancorado no
    // rodapé: sem isso ele cobre exatamente a fileira de botões do sheet no
    // primeiro acesso, que é justamente quando o convite mais importa.
    <div
      className="fixed inset-0 z-[75] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={dispensavel ? onDismiss : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Instalar o aplicativo"
    >
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border border-surface-border bg-surface-card p-5 sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {dispensavel && (
          <button
            onClick={onDismiss}
            aria-label="Fechar"
            className="float-right p-1 text-slate-400 transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {decision === 'install-android' && (
          <>
            <h2 className="mb-1 pr-8 text-base font-bold text-white">Instalar o ArenaHub?</h2>
            <p className="mb-4 text-sm text-slate-400">
              Um toque e ele vira app de verdade no seu celular — abre mais rápido e te avisa das
              suas aulas.
            </p>
            <div className="flex gap-2">
              <Button onClick={instalar} loading={instalando} className="flex-1">
                Instalar
              </Button>
              <Button onClick={onDismiss} variant="ghost">
                Agora não
              </Button>
            </div>
          </>
        )}

        {decision === 'install-ios' && (
          <>
            <div className="mb-1 flex items-center gap-2 pr-8">
              <Share size={18} className="shrink-0 text-brand-500" />
              <h2 className="text-base font-bold text-white">
                Bota o ArenaHub na sua tela de início 🏐
              </h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              10 segundos e suas aulas ficam a um toque.
            </p>

            {mostrandoPassos ? (
              <>
                <IosInstallAnimation />
                <ol className="mt-4 space-y-2 text-xs text-slate-400">
                  {PASSOS_TEXTO.map((passo, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-bold text-brand-400">{i + 1}.</span>
                      <span>{passo}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Link
                    href={`/ajuda/${manual}#instale-o-app-no-seu-celular`}
                    className="text-xs text-brand-400 underline underline-offset-2 hover:text-brand-300"
                  >
                    Ver na ajuda
                  </Link>
                  <Button onClick={onDismiss} variant="ghost" size="sm">
                    Fechar
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <Button onClick={() => setMostrandoPassos(true)} className="flex-1">
                  Ver como faz
                </Button>
                <Button onClick={onDismiss} variant="ghost">
                  Agora não
                </Button>
              </div>
            )}
          </>
        )}

        {decision === 'install-ios-inapp' && (
          <>
            <div className="mb-1 flex items-center gap-2 pr-8">
              <Compass size={18} className="shrink-0 text-brand-500" />
              <h2 className="text-base font-bold text-white">Quase lá! Abre no Safari 🧭</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Por aqui dentro o iPhone não deixa instalar. Toque nos três pontinhos no canto da
              tela e escolha <strong className="text-slate-200">&ldquo;Abrir no Safari&rdquo;</strong>.
            </p>
            <div className="flex gap-2">
              <Button onClick={copiarLink} variant="secondary" className="flex-1">
                {linkCopiado ? (
                  <>
                    <Check size={14} className="mr-1" /> Link copiado
                  </>
                ) : (
                  'Copiar link'
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
