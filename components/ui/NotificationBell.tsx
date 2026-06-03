'use client'
import { useState, useTransition } from 'react'
import { Bell } from 'lucide-react'
import { markAllNotificationsRead } from '@/features/notificacoes/actions'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  created_at: string
}

interface NotificationBellProps {
  initialNotifications: Notification[]
}

const typeIcon: Record<string, string> = {
  waitlist_offer: '🎾',
  no_credit: '⚠️',
  admin_message: '📣',
  new_event: '🏆',
}

export function NotificationBell({ initialNotifications }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [, start] = useTransition()

  const unread = notifications.filter((n) => !n.read).length

  function handleOpen() {
    setOpen((v) => !v)
    if (!open && unread > 0) {
      start(async () => {
        await markAllNotificationsRead()
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      })
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        aria-label="Notificações"
        className="relative p-2 text-slate-400 hover:text-white transition-colors"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Panel */}
          <div className="absolute right-0 top-10 z-50 w-80 max-h-96 overflow-y-auto bg-surface-card border border-surface-border rounded-2xl shadow-xl">
            <div className="px-4 py-3 border-b border-surface-border">
              <p className="text-white text-sm font-semibold">Notificações</p>
            </div>
            {notifications.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">Nenhuma notificação.</p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`px-4 py-3 border-b border-surface-border/50 last:border-0 ${
                      !n.read ? 'bg-brand-600/10' : ''
                    }`}
                  >
                    <div className="flex gap-2">
                      <span className="text-lg shrink-0">{typeIcon[n.type] ?? '🔔'}</span>
                      <div className="min-w-0">
                        <p className="text-white text-xs font-semibold">{n.title}</p>
                        <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                        <p className="text-slate-600 text-[10px] mt-1">
                          {new Date(n.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
