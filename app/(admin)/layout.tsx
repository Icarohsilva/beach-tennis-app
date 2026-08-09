// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Sparkles, Clock } from 'lucide-react'
import { createAdminClient, getStaffContext, getAuthUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'
import { AdminMobileNav } from '@/components/ui/AdminMobileNav'
import { AuroraBackground } from '@/components/ui/AuroraBackground'
import { canAccessArea, type AdminArea } from '@/lib/org/permissions'
import { getPlatformAccess } from '@/lib/billing/access'
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { LegalFooterLinks } from '@/components/ui/LegalFooterLinks'
import { SuspendedNotice } from '@/components/ui/SuspendedNotice'
import { TourProvider } from '@/components/tour/TourProvider'
import { HelpButton } from '@/components/tour/HelpButton'
import { InstallGate } from '@/components/pwa/InstallGate'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  if (user.user_metadata?.must_change_password === true) redirect('/definir-senha')

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
    .select('owner_id, name, onboarding_completed, brand_color, logo_url, status')
    .eq('id', ctx.organizationId)
    .single()

  // Academia suspensa: bloqueia o painel admin (precede gates de onboarding/cobrança).
  if (org?.status === 'suspended') return <SuspendedNotice />

  const isOwner = ctx.isOwner

  const { data: tourProfile } = await adminClient
    .from('profiles')
    .select('tour_admin_seen_at')
    .eq('id', ctx.userId)
    .single()

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
  // Banner do trial: visível durante TODO o mês grátis (desde o 1º login), ficando
  // mais urgente nos últimos 7 dias. Não repete na própria página de assinatura.
  const isTrialing = !isAssinaturaRoute && access.status === 'trialing'
  const trialUrgent = isTrialing && access.daysLeft <= 7
  const trialDaysLabel =
    access.daysLeft <= 0 ? 'hoje' : access.daysLeft === 1 ? 'em 1 dia' : `em ${access.daysLeft} dias`

  // area = chave usada por canAccessArea pra decidir se professor vê o item.
  const allNav: { href: string; label: string; area: AdminArea }[] = [
    { href: '/admin/dashboard', label: 'Dashboard', area: 'dashboard' },
    { href: '/admin/alunos', label: 'Alunos', area: 'alunos' },
    { href: '/admin/grade', label: 'Grade de Aulas', area: 'aulas' },
    { href: '/admin/wellhub', label: 'Controle Wellhub', area: 'wellhub' },
    { href: '/admin/relatorios', label: 'Relatórios', area: 'relatorios' },
    { href: '/admin/financeiro', label: 'Financeiro', area: 'financeiro' },
    { href: '/admin/notificacoes', label: 'Notificações', area: 'notificacoes' },
    { href: '/admin/torneios', label: 'Torneios', area: 'torneios' },
    { href: '/admin/liga', label: 'Liga', area: 'liga' },
    { href: '/admin/integracoes', label: 'Integrações', area: 'integracoes' },
    { href: '/admin/configuracoes', label: 'Configurações', area: 'configuracoes' },
    { href: '/admin/equipe', label: 'Equipe', area: 'equipe' },
  ]
  // Academia bloqueada só enxerga a página de assinatura: sem menu, sem link para
  // clicar. O gate por página (lib/billing/guard.ts) é quem garante o bloqueio de
  // fato — esconder o menu é a parte visível, não a tranca.
  const navLinks = access.allowed ? allNav.filter((l) => canAccessArea(l.area, isOwner)) : []

  const tourTargets: Record<string, string> = {
    '/admin/dashboard': 'tour-admin-dashboard',
    '/admin/alunos': 'tour-admin-cadastro',
    '/admin/torneios': 'tour-admin-torneios',
    '/admin/financeiro': 'tour-admin-financeiro',
    '/admin/configuracoes': 'tour-admin-config',
  }

  return (
    <div
      style={accentVars(org?.brand_color)}
      className="min-h-screen bg-surface text-white flex flex-col md:flex-row"
    >
      <AuroraBackground />
      <aside className="glass w-64 border-r border-white/[0.07] min-h-screen hidden md:flex flex-col">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-4 py-5 mb-2">
          <div className="flex items-start justify-between">
            <Logo variant="icon" size="sm" logoUrl={org?.logo_url ?? null} orgName={org?.name ?? undefined} />
            <HelpButton variant="admin" inline />
          </div>
          <span className="text-sm font-bold text-white mt-1 block truncate">
            {org?.name ?? 'Painel Admin'}
          </span>
          <span className="text-xs text-white/70 block">Painel Admin</span>
        </div>
        <div className="px-4 pb-4 flex flex-col flex-1">
          <nav className="flex flex-col gap-1 text-sm text-slate-400 flex-1">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href} data-tour={tourTargets[link.href]} className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>
          <LogoutButton className="mt-4 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors text-left w-full">
            Sair
          </LogoutButton>
          <PoweredBy className="mt-3" />
          <LegalFooterLinks className="mt-2" />
        </div>
      </aside>
      <AdminMobileNav
        links={navLinks}
        tourTargets={tourTargets}
        helpSlot={<HelpButton variant="admin" inline />}
      />
      <main className="flex-1 p-6 mt-14 md:mt-0">
        <InstallGate manual="academia" />
        {isTrialing && (
          <div
            className={
              'mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-3 text-sm ' +
              (trialUrgent
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                : 'border-brand-600/40 bg-brand-600/10 text-brand-100')
            }
          >
            {trialUrgent ? (
              <Clock className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Sparkles className="h-4 w-4 shrink-0 text-brand-400" />
            )}
            <span>
              {trialUrgent ? (
                <>
                  Seu mês grátis termina <strong>{trialDaysLabel}</strong>, assine para não
                  perder o acesso ao painel.
                </>
              ) : (
                <>
                  Você está no <strong>mês grátis</strong>. Termina{' '}
                  <strong>{trialDaysLabel}</strong>.
                </>
              )}
            </span>
            <Link
              href="/admin/assinatura"
              className={
                'font-semibold underline underline-offset-2 ' +
                (trialUrgent
                  ? 'text-amber-300 hover:text-amber-200'
                  : 'text-brand-300 hover:text-brand-200')
              }
            >
              Assinar agora
            </Link>
          </div>
        )}
        {children}
      </main>
      <TourProvider variant="admin" seenAt={tourProfile?.tour_admin_seen_at ?? null} />
    </div>
  )
}
