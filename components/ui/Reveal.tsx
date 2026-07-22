// components/ui/Reveal.tsx
import { cn } from '@/lib/utils/cn'

interface RevealProps {
  children: React.ReactNode
  /** Ordem do bloco na cascata de entrada. Cada passo atrasa 70ms. */
  step?: number
  className?: string
  as?: 'div' | 'section'
}

/**
 * Faz o bloco entrar subindo, com atraso proporcional à sua posição na página.
 * É só CSS (sem JS), então funciona em Server Components.
 */
export function Reveal({ children, step = 0, className, as: Tag = 'div' }: RevealProps) {
  return (
    <Tag
      className={cn('reveal', className)}
      style={{ '--reveal-delay': `${step * 70}ms` } as React.CSSProperties}
    >
      {children}
    </Tag>
  )
}
