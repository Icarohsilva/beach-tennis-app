// components/ui/LegalFooterLinks.tsx
import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

const LINKS = [
  { href: '/legal/termos-de-uso', label: 'Termos de Uso' },
  { href: '/legal/politica-privacidade', label: 'Privacidade' },
  { href: '/legal/politica-cookies', label: 'Cookies' },
]

export function LegalFooterLinks({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500', className)}>
      {LINKS.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="hover:text-slate-300 hover:underline">
            {l.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}
