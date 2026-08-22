'use server'
// features/perfil/calendarSyncActions.ts
// Liga/desliga/renova a assinatura de agenda externa do aluno (ver
// supabase/migrations/20260820000000_calendar_sync.sql e
// app/api/calendar/[token]/route.ts, que consome o token gerado aqui).
import crypto from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { calendarFeedUrl } from '@/lib/aulas/calendarFeedUrl'

function newToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Liga a sincronização, gerando o token na primeira vez.
 *
 * Idempotente no token: reativar depois de desligar reaproveita o mesmo link
 * (`disableCalendarSync` não apaga o token, só a flag) — só quem pede um link
 * novo de propósito usa `regenerateCalendarToken`.
 */
export async function enableCalendarSync(): Promise<{ error?: string; url?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('memberships')
    .select('calendar_feed_token')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()

  const token = (existing as { calendar_feed_token: string | null } | null)?.calendar_feed_token
    ?? newToken()

  const { error } = await admin
    .from('memberships')
    .update({ calendar_sync_enabled: true, calendar_feed_token: token })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao ativar a sincronização.' }

  revalidatePath('/perfil')
  return { url: calendarFeedUrl(token) }
}

/**
 * Desliga a sincronização. Mantém o token guardado (não apaga): a rota pública
 * confere `calendar_sync_enabled` antes de servir o feed, então o link antigo
 * já para de funcionar na hora, sem precisar invalidar o segredo em si.
 */
export async function disableCalendarSync(): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('memberships')
    .update({ calendar_sync_enabled: false })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao desligar a sincronização.' }

  revalidatePath('/perfil')
  return {}
}

/** Gera um link novo para quem suspeita que o antigo vazou. Mantém o on/off como estava. */
export async function regenerateCalendarToken(): Promise<{ error?: string; url?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const orgId = await getCurrentOrgId()
  if (!orgId) return { error: 'Academia não encontrada.' }

  const token = newToken()
  const admin = createAdminClient()
  const { error } = await admin
    .from('memberships')
    .update({ calendar_feed_token: token })
    .eq('user_id', user.id)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao gerar novo link.' }

  revalidatePath('/perfil')
  return { url: calendarFeedUrl(token) }
}
