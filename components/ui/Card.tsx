// components/ui/Card.tsx
import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-card rounded-xl border border-surface-border p-4',
        onClick && 'cursor-pointer hover:border-brand-600/50 transition-colors',
        className,
      )}
    >
      {children}
    </div>
  )
}
