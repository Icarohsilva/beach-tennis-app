// components/ui/StatCard.tsx
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'
import { AnimatedNumber } from './AnimatedNumber'
import { cn } from '@/lib/utils/cn'

interface StatCardProps {
  label: string
  value: string | number
  hint?: string
  /** Ícone do indicador, exibido numa pastilha no canto. */
  icon?: LucideIcon
  /** Sufixo colado no número (ex.: '%'). */
  suffix?: string
  /** Posição na cascata de entrada. */
  step?: number
  /**
   * Destino do card. Com href o card inteiro vira link (a seta no canto avisa que
   * é clicável, inclusive no toque — não depende de hover). Sem href, continua
   * sendo só um indicador.
   */
  href?: string
  className?: string
}

/**
 * Indicador numérico do painel. Números contam de zero ao montar; textos (ex.:
 * 'Wellhub') entram direto. O ícone é decorativo — o rótulo já nomeia o dado.
 */
export function StatCard({ label, value, hint, icon: Icon, suffix, step = 0, href, className }: StatCardProps) {
  const classes = cn(
    'glass reveal group relative block overflow-hidden rounded-2xl border border-white/[0.07] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-600/40',
    href &&
      'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    className,
  )
  const style = { '--reveal-delay': `${step * 70}ms` } as React.CSSProperties

  const conteudo = (
    <>
      {/* Brilho de marca que acende no hover. */}
      <div
        aria-hidden
        className="absolute -right-6 -top-8 h-24 w-24 rounded-full bg-brand-500/10 blur-2xl transition-opacity duration-300 group-hover:bg-brand-500/20"
      />

      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <p className="relative mt-1.5 text-3xl font-extrabold leading-none text-white">
        {typeof value === 'number' ? <AnimatedNumber value={value} suffix={suffix} /> : value}
      </p>

      {hint && (
        <p className={cn('relative mt-1 text-xs text-slate-400', href && 'pr-5')}>{hint}</p>
      )}

      {href && (
        <ArrowUpRight
          aria-hidden
          className="absolute bottom-3 right-3 h-4 w-4 text-slate-500 transition-colors duration-200 group-hover:text-brand-400"
        />
      )}
    </>
  )

  if (href) {
    return (
      <Link href={href} className={classes} style={style}>
        {conteudo}
      </Link>
    )
  }

  return (
    <div className={classes} style={style}>
      {conteudo}
    </div>
  )
}
