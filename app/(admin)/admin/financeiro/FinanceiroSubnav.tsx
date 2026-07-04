'use client'
// app/(admin)/admin/financeiro/FinanceiroSubnav.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

const tabs = [
  { href: '/admin/financeiro', label: 'Visão geral' },
  { href: '/admin/financeiro/planos', label: 'Planos e preços' },
  { href: '/admin/financeiro/integracoes', label: 'Integrações' },
]

export function FinanceiroSubnav() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-surface-border overflow-x-auto">
      {tabs.map((tab) => {
        const active =
          tab.href === '/admin/financeiro'
            ? pathname === tab.href
            : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              active
                ? 'border-brand-500 text-brand-500'
                : 'border-transparent text-slate-400 hover:text-white',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
