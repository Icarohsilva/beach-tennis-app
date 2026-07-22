// components/ui/StatCard.tsx
import type { LucideIcon } from 'lucide-react'
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
  className?: string
}

/**
 * Indicador numérico do painel. Números contam de zero ao montar; textos (ex.:
 * 'Wellhub') entram direto. O ícone é decorativo — o rótulo já nomeia o dado.
 */
export function StatCard({ label, value, hint, icon: Icon, suffix, step = 0, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'glass reveal group relative overflow-hidden rounded-2xl border border-white/[0.07] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-600/40',
        className,
      )}
      style={{ '--reveal-delay': `${step * 70}ms` } as React.CSSProperties}
    >
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

      {hint && <p className="relative mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
