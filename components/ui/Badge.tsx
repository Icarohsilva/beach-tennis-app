// components/ui/Badge.tsx
import { cn } from '@/lib/utils/cn'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'kids' | 'level' | 'success' | 'warning' | 'danger'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variants = {
    default: 'bg-surface-border text-slate-200',
    kids: 'bg-yellow-400 text-surface animate-pulse',
    level: 'bg-brand-500 text-surface',
    success: 'bg-emerald-400 text-surface',
    warning: 'bg-yellow-400 text-surface',
    danger: 'bg-red-500 text-white',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-extrabold tracking-wide', variants[variant], className)}>
      {children}
    </span>
  )
}
