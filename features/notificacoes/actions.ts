'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false)
}

export async function sendNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  const adminClient = createAdminClient()
  await adminClient.from('notifications').insert({ user_id: userId, type, title, body })
}
