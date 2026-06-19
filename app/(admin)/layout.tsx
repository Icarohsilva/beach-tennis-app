// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Sparkles } from 'lucide-react'
import { createClient, createAdminClient, getStaffContext } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'
import { AdminMobileNav } from '@/components/ui/AdminMobileNav'
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'
import { getPlatformAccess } from '@/lib/billing/access'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Contexto de staff da academia ATIVA (papel/dono vêm da membership, não de profiles).
  const ctx = await getStaffContext()
  if (!ctx) redirect('/home')

  // Use admin client for role check — bypasses RLS, gets ground-truth role
  const adminClient = createAdminClient()
  // Gate de papel: a membership da academia ativa precisa ser admin.
  const { data: membership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .single()

  if (membership?.role !== 'admin') redirect('/home')

  const { data: org } = await adminClient
    .from('organizations')
    .select('owner_id, name, onboarding_completed')
    .eq('id', ctx.organizationId)
    .single()

  const isOwner = ctx.isOwner

  // Gate: academia sem onboarding concluído não acessa o painel. Só o dono é
  // mandado pra /onboarding (só ele conclui); professor não fica em loop de
  // redirect — embora esse estado seja inalcançável (professor só é criado de
  // dentro do painel, já com onboarding concluído).
  if (org && org.onboarding_completed === false && isOwner) redirect('/onboarding')

  // Gate de cobrança da plataforma (academia→plataforma). Academia sem assinatura em
  // dia não acessa o painel — exceto a própria /admin/assinatura (senão loop). Alunos
  // não são afetados (este gate é só do painel admin). O pathname chega via header
  // setado no middleware.ts.
  const pathname = headers().get('x-pathname') ?? ''
  const isAssinaturaRoute = pathname.startsWith('/admin/assinatura')
  const access = await getPlatformAccess(ctx.organizationId)
  if (!access.allowed && !isAssinaturaRoute) redirect('/admin/assinatura')
  // Aviso suave na reta final do trial (não repete na própria página de assinatura).
  const showTrialBanner =
    !isAssinaturaRoute && access.status === 'trialing' && access.daysLeft <= 7

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
      <main className="flex-1 p-6 mt-14 md:mt-0">
        {showTrialBanner && (
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-brand-600/40 bg-brand-600/10 px-4 py-3 text-sm text-brand-100">
            <Sparkles className="h-4 w-4 shrink-0 text-brand-400" />
            <span>
              Seu mês grátis termina em{' '}
              <strong>{access.daysLeft === 1 ? '1 dia' : `${access.daysLeft} dias`}</strong>.
            </span>
            <Link
              href="/admin/assinatura"
              className="font-semibold text-brand-300 underline underline-offset-2 hover:text-brand-200"
            >
              Assinar agora
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
