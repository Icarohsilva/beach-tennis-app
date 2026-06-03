// app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/ui/BottomNav'
import { NotificationBell } from '@/components/ui/NotificationBell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  return (
    <div className="min-h-screen bg-surface text-white">
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-11 flex items-center justify-end px-3 bg-surface border-b border-surface-border/40">
        <NotificationBell initialNotifications={notifications} />
        {unreadCount > 0 && <span className="sr-only">{unreadCount} notificações não lidas</span>}
      </header>
      <main className="pt-11 pb-24">{children}</main>
      <BottomNav />
    </div>
  )
}
