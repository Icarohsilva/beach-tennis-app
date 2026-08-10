// components/ui/BottomNav.tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Home, MapPin, Plus, Trophy, User } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface NavEntry {
  href: string
  icon: typeof Home
  label: string
  dataTour?: string
}

// Menu de quem é aluno de alguma academia: a rotina (agenda, arena, liga) e o
// perfil. É o menu que existia antes de a conta livre existir.
const STUDENT_NAV: NavEntry[] = [
  { href: '/home', icon: Home, label: 'Home' },
  { href: '/torneios', icon: MapPin, label: 'Arena', dataTour: 'tour-aluno-arena' },
  { href: '/liga', icon: Trophy, label: 'Liga' },
  { href: '/perfil', icon: User, label: 'Perfil', dataTour: 'tour-aluno-perfil' },
]

// Menu de quem ainda não é aluno de ninguém (conta livre) ou só entrou como
// atleta de torneio. Home, Liga e a agenda de aulas seriam telas vazias: ele
// não tem turma, não tem plano e não pontua em ranking. O que ele tem é
// descobrir arena e acompanhar os torneios em que entrou.
const VISITOR_NAV: NavEntry[] = [
  { href: '/explorar', icon: Compass, label: 'Explorar' },
  { href: '/torneios', icon: MapPin, label: 'Arena' },
  { href: '/perfil', icon: User, label: 'Perfil' },
]

interface BottomNavProps {
  /**
   * A pessoa é aluno (ou admin) de pelo menos uma academia. Falso para conta
   * livre e para quem só tem vínculo de atleta.
   */
  isStudent?: boolean
}

export function BottomNav({ isStudent = true }: BottomNavProps) {
  const pathname = usePathname()

  // O visitante não tem o botão central de agendar: agendar aula pressupõe
  // turma, e ele não tem. O menu dele é simples e sem o furo do meio.
  if (!isStudent) {
    return (
      <nav className="glass fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.07]">
        <div className="flex items-center justify-around px-2 pb-safe">
          {VISITOR_NAV.map((item) => (
            <NavItem key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </div>
      </nav>
    )
  }

  return (
    <nav className="glass fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.07]">
      <div className="flex items-center justify-around px-2 pb-safe">
        {STUDENT_NAV.slice(0, 2).map((item) => (
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

        {STUDENT_NAV.slice(2).map((item) => (
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
