// components/ui/Card.tsx
import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  /** Borda lateral laranja para destacar o card (próxima aula, item ativo). */
  accent?: boolean
}

export function Card({ children, className, onClick, accent }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface-card rounded-xl border border-surface-border p-4',
        accent && 'border-l-[3px] border-l-brand-500',
        onClick && 'cursor-pointer hover:border-brand-600/50 transition-colors active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </div>
  )
}
