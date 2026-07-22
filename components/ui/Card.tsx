// components/ui/Card.tsx
import { cn } from '@/lib/utils/cn'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  /** Borda lateral laranja para destacar o card (próxima aula, item ativo). */
  accent?: boolean
  /** Superfície translúcida com desfoque, para cards sobre a aurora do fundo. */
  glass?: boolean
  /** Levanta e acende a borda no hover — para cards que são links. */
  interactive?: boolean
}

export function Card({ children, className, onClick, accent, glass, interactive }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4',
        glass
          ? 'glass border-white/[0.07] rounded-2xl'
          : 'bg-surface-card border-surface-border',
        accent && 'border-l-[3px] border-l-brand-500',
        (onClick || interactive) &&
          'cursor-pointer transition-all duration-200 hover:border-brand-600/50 hover:-translate-y-0.5 active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </div>
  )
}
