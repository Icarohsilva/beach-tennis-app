'use client'
// app/(super-admin)/SuperAdminNav.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

export interface NavItem {
  href: string
  label: string
  /** Contador de pendências — some quando zero. */
  badge?: number
}

/**
 * Navegação do painel de plataforma. Marca o item ativo pelo pathname e mostra
 * o volume das filas direto no menu, para o que está pendente não depender de
 * alguém lembrar de abrir a página.
 */
export function SuperAdminNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname()

  return (
    <nav className={cn('flex gap-1 overflow-x-auto', className)}>
      {items.map((item) => {
        // /super-admin só casa exato: senão ficaria ativo em todas as subrotas.
        const active =
          item.href === '/super-admin' ? pathname === item.href : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors',
              active
                ? 'bg-brand-600/15 text-brand-300 ring-1 ring-inset ring-brand-600/30'
                : 'text-slate-400 hover:bg-surface-card hover:text-white',
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-extrabold text-red-300">
                {item.badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
