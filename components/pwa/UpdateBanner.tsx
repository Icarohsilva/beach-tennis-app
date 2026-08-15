'use client'
// components/pwa/UpdateBanner.tsx
// Aviso de versão nova, quando não dá para recarregar sozinho sem risco.
//
// Separado da lógica (VersionGate) para que a bancada de responsividade
// (app/dev/responsivo) meça exatamente esta marcação, sem precisar de fetch nem de
// deploy. Duplicar o layout na bancada faria o teste passar sobre marcação
// desatualizada — que é o mesmo que não medir nada.
import { RefreshCw } from 'lucide-react'

/**
 * `onReload` é opcional e cai em `location.reload()`. Sem isso a bancada
 * (app/dev/responsivo), que é Server Component, não conseguiria renderizar este
 * componente — passar função de servidor para client é erro de runtime, e derrubava
 * a página inteira em 500.
 */
export function UpdateBanner({ onReload }: { onReload?: () => void }) {
  const recarregar = onReload ?? (() => window.location.reload())
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-brand-500/40 bg-surface-card/95 px-4 pb-safe pt-3 backdrop-blur-sm"
    >
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-2 pb-3">
        <p className="min-w-0 text-sm text-white">
          Nova versão disponível.{' '}
          <span className="text-slate-400">Atualize para continuar com tudo em dia.</span>
        </p>
        <button
          type="button"
          onClick={recarregar}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-3.5 py-1.5 text-xs font-bold text-white transition-transform active:scale-95"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          Atualizar
        </button>
      </div>
    </div>
  )
}
