// components/ui/CollapsibleCard.tsx
// Card que abre e fecha pelo cabeçalho. Nasce FECHADO.
//
// É <details> nativo, e não estado em React: funciona em Server Component, não
// pisca na hidratação e o teclado já sabe abrir (Enter/Espaço no <summary>).
// O `open` não é passado ao DOM de propósito — assim o React não o reescreve a
// cada revalidação, e o card aberto continua aberto depois de salvar algo.
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface Props {
  title: string
  /** Linha de apoio embaixo do título. */
  subtitle?: React.ReactNode
  /** Resumo à direita do título ("2 eventos"): o que diz se vale abrir. */
  meta?: React.ReactNode
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function CollapsibleCard({ title, subtitle, meta, icon, children, className }: Props) {
  return (
    <details
      className={cn(
        'group overflow-hidden rounded-xl border border-surface-border bg-surface-card',
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 transition-colors hover:bg-white/[0.02] [&::-webkit-details-marker]:hidden">
        {icon && <span className="shrink-0 text-brand-500">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-white">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-slate-400">{subtitle}</span>}
        </span>
        {meta && (
          <span className="shrink-0 rounded-full border border-surface-border bg-surface px-2 py-0.5 text-xs text-slate-300">
            {meta}
          </span>
        )}
        <ChevronDown
          className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-surface-border p-4">{children}</div>
    </details>
  )
}
