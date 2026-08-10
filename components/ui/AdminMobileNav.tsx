'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { LogoutButton } from './LogoutButton'
import { LegalFooterLinks } from './LegalFooterLinks'

interface NavLink { href: string; label: string }

export function AdminMobileNav({
  links,
  tourTargets,
  helpSlot,
}: {
  links: NavLink[]
  tourTargets?: Record<string, string>
  helpSlot?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  // O tour (mobile) abre/fecha a lista para destacar cada seção.
  useEffect(() => {
    const openMenu = () => setOpen(true)
    const closeMenu = () => setOpen(false)
    window.addEventListener('tour:admin-menu-open', openMenu)
    window.addEventListener('tour:admin-menu-close', closeMenu)
    return () => {
      window.removeEventListener('tour:admin-menu-open', openMenu)
      window.removeEventListener('tour:admin-menu-close', closeMenu)
    }
  }, [])

  return (
    <>
      {/* Fixed topbar — only visible on mobile */}
      {/* Altura fixa h-12: o dropdown abaixo é posicionado em `top-12`, e com a
          altura derivada do conteúdo (py-3 + ícone) a barra e o dropdown não
          fechavam exatamente — sobrava uma costura de alguns pixels. */}
      <div className="fixed top-0 left-0 right-0 z-50 flex h-12 items-center justify-between gap-2 px-4 bg-surface-card border-b border-surface-border md:hidden">
        <span className="text-white font-semibold text-sm">Painel Admin</span>
        <div className="flex items-center gap-2">
          {helpSlot}
          <button onClick={() => setOpen(v => !v)} className="text-slate-400 hover:text-white p-1" aria-label="Menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {/* Dropdown */}
      {open && (
        <div className="fixed top-12 left-0 right-0 z-40 bg-surface-card border-b border-surface-border shadow-lg md:hidden">
          <nav className="flex flex-col py-2">
            {links.map(link => (
              <Link key={link.href} href={link.href} data-tour={tourTargets?.[link.href]} onClick={() => setOpen(false)}
                className="px-4 py-3 text-sm text-slate-300 hover:bg-surface-border hover:text-white transition-colors">
                {link.label}
              </Link>
            ))}
            <div className="border-t border-surface-border mt-2 pt-2">
              <LogoutButton className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-900/20 transition-colors">
                Sair
              </LogoutButton>
            </div>
            <LegalFooterLinks className="px-4 py-3" />
          </nav>
        </div>
      )}
    </>
  )
}
