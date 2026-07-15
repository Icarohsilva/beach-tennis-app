'use server'
// features/notifications/pushActions.ts
// Salva/remove a inscrição de push do usuário autenticado. Usa createClient
// (contexto do usuário) — a RLS garante que ninguém mexa em inscrição alheia.
import { createClient, getActiveOrgId } from '@/lib/supabase/server'

export interface BrowserPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function savePushSubscription(
  sub: BrowserPushSubscription,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getActiveOrgId()

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      organization_id: orgId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: 'endpoint' },
  )

  if (error) return { error: 'Não foi possível salvar a inscrição de notificações.' }
  return {}
}

export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return { error: 'Não foi possível remover a inscrição.' }
  return {}
}
