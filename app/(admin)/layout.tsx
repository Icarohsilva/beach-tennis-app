// app/(admin)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/home')

  return (
    <div className="min-h-screen bg-surface text-white flex">
      <aside className="w-64 bg-surface-card border-r border-surface-border min-h-screen p-4 hidden md:block">
        <h2 className="text-brand-500 font-bold text-lg mb-6">🎾 Admin</h2>
        <nav className="flex flex-col gap-1 text-sm text-slate-400">
          <a href="/admin/dashboard" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Dashboard</a>
          <a href="/admin/alunos" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Alunos</a>
          <a href="/admin/grade" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Grade de Aulas</a>
          <a href="/admin/financeiro" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Financeiro</a>
          <a href="/admin/notificacoes" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Notificações</a>
          <a href="/admin/torneios" className="px-3 py-2 rounded hover:bg-surface-border hover:text-white transition-colors">Torneios</a>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
