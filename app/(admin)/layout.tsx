// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { Logo } from '@/components/ui/Logo'

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
    <div className="min-h-screen bg-surface text-white flex">
      <aside className="w-64 bg-surface-card border-r border-surface-border min-h-screen p-4 hidden md:flex flex-col">
        <div className="mb-6">
          <Logo variant="full" size="sm" />
          <span className="text-xs text-slate-500 mt-1 block">Painel Admin</span>
        </div>
        <nav className="flex flex-col gap-1 text-sm text-slate-400 flex-1">
          <Link href="/admin/dashboard" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Dashboard</Link>
          <Link href="/admin/alunos" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Alunos</Link>
          <Link href="/admin/grade" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Grade de Aulas</Link>
          <Link href="/admin/financeiro" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Financeiro</Link>
          <Link href="/admin/notificacoes" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Notificações</Link>
          <Link href="/admin/torneios" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Torneios</Link>
        </nav>
        <LogoutButton className="mt-4 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors text-left w-full">
          Sair
        </LogoutButton>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
