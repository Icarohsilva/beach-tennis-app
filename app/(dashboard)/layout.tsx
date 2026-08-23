// app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getCurrentOrg, getMemberships, getActiveOrgId, resolveActiveOrgForUser, getAuthUser } from '@/lib/supabase/server'
import { BottomNav } from '@/components/ui/BottomNav'
import { AuroraBackground } from '@/components/ui/AuroraBackground'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { OrgSwitcher } from '@/components/ui/OrgSwitcher'
import { Logo } from '@/components/ui/Logo'
import { hasStudentAccess, isStaffOfActiveOrg } from '@/lib/org/activeOrg'
import { accentVars } from '@/lib/branding/theme'
import { PoweredBy } from '@/components/ui/PoweredBy'
import { LegalFooterLinks } from '@/components/ui/LegalFooterLinks'
import { SuspendedNotice } from '@/components/ui/SuspendedNotice'
import { TourProvider } from '@/components/tour/TourProvider'
import { HelpButton } from '@/components/tour/HelpButton'
import { InstallGate } from '@/components/pwa/InstallGate'
import { PullToRefresh } from '@/components/ui/PullToRefresh'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const user = await getAuthUser()
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
  // Conta livre e vínculo só de atleta não têm turma, plano nem ranking: Home,
  // Liga e a agenda seriam telas vazias. O menu deles é Explorar/Arena/Perfil.
  const isStudent = hasStudentAccess(memberships)
  // Porta de volta ao painel. Sem ela, o admin que cai aqui (é o start_url do
  // PWA) não tinha caminho nenhum de volta a não ser sair e entrar de novo, e
  // parecia ter "virado aluno". Zero consulta extra: memberships e activeOrgId
  // já estão carregados acima.
  const isStaff = isStaffOfActiveOrg(memberships, activeOrgId)

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
            {/* Sem academia o nome sairia vazio e a barra ficaria órfã. */}
            <span className="text-sm font-semibold text-white truncate">{org?.name ?? 'ArenaHub'}</span>
          </span>
        )}
        <div className="flex items-center gap-1">
          {/* shrink-0 + whitespace-nowrap: divide a barra de 44px com o nome da
              academia, que é truncado — sem isso o rótulo quebraria antes dele. */}
          {isStaff && (
            <Link
              href="/admin/dashboard"
              className="shrink-0 whitespace-nowrap rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold text-brand-300 transition-colors hover:bg-brand-500/20"
            >
              Painel
            </Link>
          )}
          <HelpButton variant="aluno" inline />
          <NotificationBell initialNotifications={notifications} orgName={org?.name ?? null} />
        </div>
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
      </header>
      <main className="pt-11 pb-24">
        <PullToRefresh>
          {/* px-4 aqui, e não no componente: o layout admin já tem p-6 próprio. */}
          <div className="px-4">
            <InstallGate manual="aluno" />
          </div>
          {children}
          <div className="mt-8 mb-4 flex flex-col items-center gap-3">
            <PoweredBy />
            <LegalFooterLinks />
          </div>
        </PullToRefresh>
      </main>
      <BottomNav isStudent={isStudent} />
      {/* O tour explica agenda, chamada e créditos — nada disso existe para
          quem ainda não é aluno de uma academia. */}
      {isStudent && <TourProvider variant="aluno" seenAt={tourProfile?.tour_aluno_seen_at ?? null} />}
    </div>
  )
}
