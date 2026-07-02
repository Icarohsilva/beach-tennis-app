// app/(super-admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LogoutButton } from '@/components/ui/LogoutButton'

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
    .select('is_platform_admin')
    .eq('id', user.id)
    .single()
  if (profile?.is_platform_admin !== true) redirect('/home')

  return (
    <div className="min-h-screen bg-surface text-white">
      <header className="flex h-14 items-center justify-between border-b border-surface-border px-4">
        <span className="text-sm font-bold">ArenaHub · Plataforma</span>
        <LogoutButton className="text-sm font-semibold text-red-400 hover:text-red-300">
          Sair
        </LogoutButton>
      </header>
      <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  )
}
