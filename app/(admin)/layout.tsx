// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'
import { AdminMobileNav } from '@/components/ui/AdminMobileNav'
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'

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

  const { data: profileOrg } = await adminClient
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  const { data: org } = profileOrg?.organization_id
    ? await adminClient
        .from('organizations')
        .select('owner_id, name, onboarding_completed')
        .eq('id', profileOrg.organization_id)
        .single()
    : { data: null as { owner_id: string; name: string; onboarding_completed: boolean } | null }

  const isOwner = org?.owner_id === user.id

  // Gate: academia sem onboarding concluído não acessa o painel. Só o dono é
  // mandado pra /onboarding (só ele conclui); professor não fica em loop de
  // redirect — embora esse estado seja inalcançável (professor só é criado de
  // dentro do painel, já com onboarding concluído).
  if (org && org.onboarding_completed === false && isOwner) redirect('/onboarding')

  // area = chave usada por canAccessArea pra decidir se professor vê o item.
  const allNav: { href: string; label: string; area: AdminArea }[] = [
    { href: '/admin/dashboard', label: 'Dashboard', area: 'dashboard' },
    { href: '/admin/alunos', label: 'Alunos', area: 'alunos' },
    { href: '/admin/grade', label: 'Grade de Aulas', area: 'aulas' },
    { href: '/admin/financeiro', label: 'Financeiro', area: 'financeiro' },
    { href: '/admin/notificacoes', label: 'Notificações', area: 'notificacoes' },
    { href: '/admin/torneios', label: 'Torneios', area: 'torneios' },
    { href: '/admin/configuracoes', label: 'Configurações', area: 'configuracoes' },
    { href: '/admin/equipe', label: 'Equipe', area: 'equipe' },
  ]
  const navLinks = allNav.filter((l) => canAccessArea(l.area, isOwner))

  return (
    <div className="min-h-screen bg-surface text-white flex flex-col md:flex-row">
      <aside className="w-64 bg-surface-card border-r border-surface-border min-h-screen hidden md:flex flex-col">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-5 mb-2">
          <Logo variant="icon" size="sm" />
          <span className="text-sm font-bold text-white mt-1 block truncate">
            {org?.name ?? 'Painel Admin'}
          </span>
          <span className="text-xs text-white/70 block">Painel Admin</span>
        </div>
        <div className="px-4 pb-4 flex flex-col flex-1">
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
        </div>
      </aside>
      <AdminMobileNav links={navLinks} />
      <main className="flex-1 p-6 mt-14 md:mt-0">{children}</main>
    </div>
  )
}
