// components/ui/Button.tsx
import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const BASE = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'

// TODA variante tem superfície e sombra. Botão que é só texto no meio da tela
// não se lê como botão — foi a crítica que motivou isto, e ela vale para o app
// inteiro, não só para a tela onde apareceu.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-r from-brand-600 to-brand-700 text-white hover:from-brand-500 hover:to-brand-600 shadow-md shadow-brand-600/25',
  secondary: 'bg-surface-card text-white border border-surface-border hover:bg-surface-border shadow-md shadow-black/30',
  // `ghost` é o mais discreto, não o invisível: mantém superfície e sombra leve
  // para continuar parecendo clicável.
  ghost: 'bg-white/[0.04] text-slate-200 border border-white/10 hover:bg-white/[0.08] hover:text-white shadow-sm shadow-black/20',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-900/40',
  whatsapp: 'bg-green-600 text-white hover:bg-green-500 shadow-md shadow-green-900/40',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

/**
 * As classes de botão, para quem NÃO é `<button>`.
 *
 * Link externo (`<a>` de WhatsApp, download) não pode virar `<button>`, e
 * copiar as classes na mão foi como nasceram os "botões" sem sombra que a
 * revisão apontou. Com isto a forma tem uma fonte só.
 */
export function buttonClasses(opts: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}): string {
  return cn(BASE, VARIANTS[opts.variant ?? 'primary'], SIZES[opts.size ?? 'md'], opts.className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={buttonClasses({ variant, size, className })}
        {...props}
      >
        {loading ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
