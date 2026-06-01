// components/ui/Badge.tsx
import { cn } from '@/lib/utils/cn'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'kids' | 'level' | 'success' | 'warning' | 'danger'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  const variants = {
    default: 'bg-surface-border text-slate-300',
    kids: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 animate-pulse',
    level: 'bg-brand-600/20 text-brand-400 border border-brand-600/50',
    success: 'bg-green-500/20 text-green-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    danger: 'bg-red-500/20 text-red-400',
  }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold', variants[variant], className)}>
      {children}
    </span>
  )
}
