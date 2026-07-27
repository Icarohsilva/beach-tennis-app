// app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, getCurrentOrg, getMemberships, getActiveOrgId, resolveActiveOrgForUser } from '@/lib/supabase/server'
import { BottomNav } from '@/components/ui/BottomNav'
import { AuroraBackground } from '@/components/ui/AuroraBackground'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { OrgSwitcher } from '@/components/ui/OrgSwitcher'
import { Logo } from '@/components/ui/Logo'
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { LegalFooterLinks } from '@/components/ui/LegalFooterLinks'
import { SuspendedNotice } from '@/components/ui/SuspendedNotice'
import { TourProvider } from '@/components/tour/TourProvider'
import { HelpButton } from '@/components/tour/HelpButton'
import { InstallGate } from '@/components/pwa/InstallGate'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (user.user_metadata?.must_change_password === true) redirect('/definir-senha')

  // Gancho do Plano 3: com 2+ academias e sem cookie válido, manda escolher.
  // No Plano 2 ninguém tem 2 memberships, então 'choose' nunca dispara (rota só
  // existe a partir do Plano 3). 'none' (sem academia) segue normalmente.
  const res = await resolveActiveOrgForUser()
  if (res.status === 'choose') redirect('/selecionar-academia')

  const org = await getCurrentOrg()
  // Academia suspensa: bloqueia o acesso do aluno (tela terminal, sem navegação).
  if (org?.status === 'suspended') return <SuspendedNotice />
  const memberships = await getMemberships()
  const activeOrgId = await getActiveOrgId()

  // Fetch recent notifications (last 20)
  const { data: notificationsRaw } = await supabase
    .from('notifications')
    .select('id, type, title, body, read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const notifications = (notificationsRaw ?? []) as {
    id: string
    type: string
    title: string
    body: string
    read: boolean
    created_at: string
  }[]

  const unreadCount = notifications.filter((n) => !n.read).length

  const { data: tourProfile } = await supabase
    .from('profiles')
    .select('tour_aluno_seen_at')
    .eq('id', user.id)
    .single()

  return (
    <div style={accentVars(org?.brand_color)} className="min-h-screen bg-surface text-white">
      <AuroraBackground />
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-11 flex items-center justify-between px-3 bg-surface/80 backdrop-blur-md border-b border-surface-border/40">
        {memberships.length > 1 && activeOrgId ? (
          <OrgSwitcher
            items={memberships.map((m) => ({ organization_id: m.organization_id, org_name: m.org_name }))}
            activeOrgId={activeOrgId}
          />
        ) : (
          <span className="inline-flex items-center gap-2 max-w-[60%]">
            <Logo variant="icon" size="sm" logoUrl={org?.logo_url ?? null} orgName={org?.name ?? undefined} />
            <span className="text-sm font-semibold text-white truncate">{org?.name ?? ''}</span>
          </span>
        )}
        <div className="flex items-center gap-1">
          <HelpButton variant="aluno" inline />
          <NotificationBell initialNotifications={notifications} orgName={org?.name ?? null} />
        </div>
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
      </header>
      <main className="pt-11 pb-24">
        <InstallGate />
        {children}
        <div className="mt-8 mb-4 flex flex-col items-center gap-3">
          <PoweredBy />
          <LegalFooterLinks />
        </div>
      </main>
      <BottomNav />
      <TourProvider variant="aluno" seenAt={tourProfile?.tour_aluno_seen_at ?? null} />
    </div>
  )
}
