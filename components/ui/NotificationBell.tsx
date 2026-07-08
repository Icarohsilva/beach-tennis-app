'use client'
import { useState, useTransition } from 'react'
import { Bell, X } from 'lucide-react'
import { markAllNotificationsRead, deleteNotification } from '@/features/notificacoes/actions'
import { notificationSender } from '@/lib/utils/notificationSender'

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
  orgName?: string | null
}

const typeIcon: Record<string, string> = {
  waitlist_offer: '🎾',
  no_credit: '⚠️',
  admin_message: '📣',
  new_event: '🏆',
}

export function NotificationBell({ initialNotifications, orgName }: NotificationBellProps) {
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

  function handleDelete(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
    start(async () => {
      await deleteNotification(id)
    })
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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[min(20rem,calc(100vw-1.5rem))] max-h-96 overflow-y-auto bg-surface-card border border-surface-border rounded-2xl shadow-xl">
            <div className="px-4 py-2.5 border-b border-surface-border">
              <p className="text-white text-sm font-semibold">Notificações</p>
            </div>
            {notifications.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">Nenhuma notificação.</p>
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`group relative px-3 py-2.5 border-b border-surface-border/50 last:border-0 ${
                      !n.read ? 'bg-brand-600/10' : ''
                    }`}
                  >
                    <div className="flex gap-2">
                      <span className="text-base shrink-0 leading-5">{typeIcon[n.type] ?? '🔔'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-white text-xs font-semibold truncate">{n.title}</p>
                          <button
                            onClick={() => handleDelete(n.id)}
                            aria-label="Excluir notificação"
                            className="shrink-0 text-slate-500 hover:text-red-400 p-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.body}</p>
                        <p className="text-slate-600 text-[10px] mt-1">
                          {notificationSender(n.type, orgName)} ·{' '}
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
