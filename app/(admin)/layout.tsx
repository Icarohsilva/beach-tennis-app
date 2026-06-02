// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'
import { AdminMobileNav } from '@/components/ui/AdminMobileNav'

const navLinks = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/alunos', label: 'Alunos' },
  { href: '/admin/grade', label: 'Grade de Aulas' },
  { href: '/admin/financeiro', label: 'Financeiro' },
  { href: '/admin/notificacoes', label: 'Notificações' },
  { href: '/admin/torneios', label: 'Torneios' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use admin client for role check — bypasses RLS, gets ground-truth role
  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/home')

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col md:flex-row">
      <aside className="w-64 bg-surface-card border-r border-surface-border min-h-screen p-4 hidden md:flex flex-col">
        <div className="mb-6">
          <Logo variant="full" size="sm" />
          <span className="text-xs text-slate-500 mt-1 block">Painel Admin</span>
        </div>
        <nav className="flex flex-col gap-1 text-sm text-slate-400 flex-1">
          {navLinks.map(link => (
            <Link key={link.href} href={link.href} className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>
        <LogoutButton className="mt-4 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors text-left w-full">
          Sair
        </LogoutButton>
      </aside>
      <AdminMobileNav links={navLinks} />
      <main className="flex-1 p-6 mt-14 md:mt-0">{children}</main>
    </div>
  )
}
