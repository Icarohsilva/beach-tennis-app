// app/(super-admin)/layout.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { getPlatformSnapshot } from '@/features/super-admin/platformQueries'
import { SuperAdminNav, type NavItem } from './SuperAdminNav'

// Gate do painel de PLATAFORMA. Independe de academia ativa/membership. Papel
// verificado via service role (ground-truth, ignora RLS).
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_platform_admin, full_name')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) redirect('/home')

  // Contadores das filas no menu. O snapshot é cacheado por request (React
  // cache), então a página abaixo reaproveita esta mesma leitura.
  const { queues } = await getPlatformSnapshot()

  const items: NavItem[] = [
    { href: '/super-admin', label: 'Visão geral' },
    { href: '/super-admin/academias', label: 'Academias' },
    { href: '/super-admin/reembolsos', label: 'Reembolsos', badge: queues.pendingRefunds },
    { href: '/super-admin/exclusoes', label: 'Exclusões', badge: queues.pendingDeletions },
    { href: '/super-admin/feedback', label: 'Feedback', badge: queues.unreadFeedback },
    { href: '/super-admin/auditoria', label: 'Auditoria' },
  ]

  return (
    <div className="min-h-screen bg-surface text-white">
      <header className="sticky top-0 z-20 border-b border-surface-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/super-admin" className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-brand-800">
              <ShieldCheck className="h-4 w-4 text-white" />
            </span>
            <span className="text-sm font-bold">
              ArenaHub <span className="text-slate-500">· Plataforma</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">
              {profile.full_name ?? user.email}
            </span>
            <LogoutButton className="text-sm font-semibold text-red-400 hover:text-red-300">
              Sair
            </LogoutButton>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 pb-2">
          <SuperAdminNav items={items} />
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  )
}
