// components/ui/BottomNav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, MapPin, Plus, Users, User } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const navItems = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/torneios', icon: MapPin, label: 'Arena', dataTour: 'tour-aluno-arena' },
  { href: '/comunidade', icon: Users, label: 'Comunidade' },
  { href: '/perfil', icon: User, label: 'Perfil', dataTour: 'tour-aluno-perfil' },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.07]">
      <div className="flex items-center justify-around px-2 pb-safe">
        {navItems.slice(0, 2).map((item) => (
          <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}

        <Link href="/agendar" data-tour="tour-aluno-agendar" className="relative -top-5">
          <div className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-600/40 border-4 border-surface transition-transform active:scale-95',
            pathname.startsWith('/agendar') && 'from-brand-400 to-brand-600',
          )}>
            <Plus className="h-6 w-6 text-white" />
          </div>
        </Link>

        {navItems.slice(2).map((item) => (
          <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
        ))}
      </div>
    </nav>
  )
}

function NavItem({ href, icon: Icon, label, active, dataTour }: { href: string; icon: typeof Home; label: string; active: boolean; dataTour?: string }) {
  return (
    <Link href={href} data-tour={dataTour} className="flex flex-col items-center gap-0.5 py-2 px-3">
      <Icon className={cn('h-5 w-5', active ? 'text-brand-500' : 'text-slate-500')} />
      <span className={cn('text-[10px] font-medium', active ? 'text-brand-500' : 'text-slate-500')}>{label}</span>
    </Link>
  )
}
