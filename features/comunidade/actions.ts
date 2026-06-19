'use server'
// features/comunidade/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { StudentLevel, PaymentType } from '@/types'

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

/**
 * Creates a new post from the authenticated student.
 * Images are expected to already be uploaded to Supabase Storage and
 * their public URLs passed in imageUrls. The caller (CreatePost component)
 * must upload images first and pass the resulting public URLs.
 */
export async function createPost(params: {
  content: string
  imageUrls: string[]
  sessionId?: string
  tournamentId?: string
}): Promise<{ error?: string; post?: { id: string; organization_id: string; author_id: string; content: string; image_urls: string[]; likes_count: number; session_id: string | null; tournament_id: string | null; created_at: string; author: { id: string; full_name: string; avatar_url: string | null } } }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const { content, imageUrls, sessionId, tournamentId } = params

  if (!content.trim() && imageUrls.length === 0) {
    return { error: 'O post precisa ter texto ou pelo menos uma imagem.' }
  }

  const adminClient = createAdminClient()

  // Post pertence à academia ATIVA. Identidade (nome/avatar) vem de profiles.
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: authorProfile } = await adminClient
    .from('profiles')
    .select('id, full_name, avatar_url')
    .eq('id', user.id)
    .single()

  const { data: post, error: insertErr } = await adminClient
    .from('posts')
    .insert({
      organization_id: orgId,
      author_id: user.id,
      content: content.trim(),
      image_urls: imageUrls,
      likes_count: 0,
      session_id: sessionId ?? null,
      tournament_id: tournamentId ?? null,
    })
    .select('id, created_at')
    .single()

  if (insertErr || !post) return { error: 'Erro ao criar post. Tente novamente.' }

  revalidatePath('/comunidade')

  const p = post as { id: string; created_at: string }
  return {
    post: {
      id: p.id,
      organization_id: orgId,
      author_id: user.id,
      content: content.trim(),
      image_urls: imageUrls,
      likes_count: 0,
      session_id: sessionId ?? null,
      tournament_id: tournamentId ?? null,
      created_at: p.created_at,
      author: {
        id: user.id,
        full_name: (authorProfile as { id: string; full_name: string; avatar_url: string | null } | null)?.full_name ?? 'Aluno',
        avatar_url: (authorProfile as { id: string; full_name: string; avatar_url: string | null } | null)?.avatar_url ?? null,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// toggleLike
// ---------------------------------------------------------------------------

/**
 * Toggles like on a post for the authenticated student.
 * - Uses upsert with ON CONFLICT DO NOTHING for idempotency
 * - Updates posts.likes_count atomically
 */
export async function toggleLike(
  postId: string,
): Promise<{ error?: string; liked?: boolean }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  const likerOrgId = await getActiveOrgId()
  if (!likerOrgId) return { error: 'Academia ativa não encontrada.' }

  // Check if the like already exists
  const { data: existingLike } = await adminClient
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingLike) {
    // Unlike: remove the like
    const { error: deleteErr } = await adminClient
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id)

    if (deleteErr) return { error: 'Erro ao remover curtida.' }

    // Decrement likes_count atomically (never below 0)
    await adminClient.rpc('decrement_likes_count', { post_id: postId })

    revalidatePath('/comunidade')
    return { liked: false }
  } else {
    // Like: upsert with ON CONFLICT DO NOTHING for idempotency
    const { error: insertErr } = await adminClient
      .from('post_likes')
      .upsert(
        { post_id: postId, user_id: user.id, organization_id: likerOrgId },
        { onConflict: 'post_id,user_id', ignoreDuplicates: true },
      )

    if (insertErr) return { error: 'Erro ao curtir post.' }

    // Increment likes_count atomically
    await adminClient.rpc('increment_likes_count', { post_id: postId })

    revalidatePath('/comunidade')
    return { liked: true }
  }
}

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------

/**
 * Adds a comment to a post from the authenticated student.
 */
export async function addComment(
  postId: string,
  content: string,
): Promise<{ error?: string; commentId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  if (!content.trim()) return { error: 'O comentário não pode estar vazio.' }

  const adminClient = createAdminClient()

  const commenterOrgId = await getActiveOrgId()
  if (!commenterOrgId) return { error: 'Academia ativa não encontrada.' }

  const { data: comment, error: insertErr } = await adminClient
    .from('post_comments')
    .insert({
      organization_id: commenterOrgId,
      post_id: postId,
      author_id: user.id,
      content: content.trim(),
    })
    .select('id')
    .single()

  if (insertErr || !comment) return { error: 'Erro ao adicionar comentário.' }

  revalidatePath('/comunidade')
  return { commentId: comment.id }
}

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

/**
 * Sends a notification to a filtered set of students.
 * - Inserts records in `notifications` table for each recipient
 * - Sends email via Resend SDK (server-side)
 * - WhatsApp via stub (WHATSAPP_GATEWAY env var — real gateway TBD)
 * - Web Push: only for students with push_subscription; silently skips others
 *
 * Filter modes:
 *   - 'all'       : all students with contract_active = true
 *   - 'by_level'  : filter by profile.level (requires filterValue: StudentLevel)
 *   - 'by_plan'   : filter by profile.payment_type (requires filterValue: PaymentType)
 *   - 'pwa_only'  : only students with a push_subscription registered
 */
export async function sendNotification(params: {
  title: string
  body: string
  type: string
  filterMode: 'all' | 'by_level' | 'by_plan' | 'pwa_only'
  filterValue?: string
  channels: Array<'push' | 'email' | 'whatsapp'>
}): Promise<{ error?: string; sentCount?: number }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()

  // Academia ATIVA + verificação de admin via membership desta academia.
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()

  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  const { title, body, type, filterMode, filterValue, channels } = params

  if (!title.trim() || !body.trim()) {
    return { error: 'Título e mensagem são obrigatórios.' }
  }

  // Destinatários: memberships de alunos da academia ativa. Os campos por-academia
  // (level, payment_type, contract_active) vivem na membership.
  let memQuery = adminClient
    .from('memberships')
    .select('user_id, level, payment_type')
    .eq('organization_id', orgId)
    .eq('role', 'student')
    .eq('contract_active', true)

  if (filterMode === 'by_level' && filterValue) {
    memQuery = memQuery.eq('level', filterValue as StudentLevel)
  } else if (filterMode === 'by_plan' && filterValue) {
    memQuery = memQuery.eq('payment_type', filterValue as PaymentType)
  }

  const { data: members, error: membersErr } = await memQuery
  if (membersErr) return { error: 'Erro ao buscar destinatários.' }
  let memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)

  if (filterMode === 'pwa_only') {
    const { data: pushSubs } = await adminClient
      .from('push_subscriptions')
      .select('user_id')
    const pushIds = new Set((pushSubs ?? []).map((s: { user_id: string }) => s.user_id))
    memberIds = memberIds.filter((id) => pushIds.has(id))
  }

  if (memberIds.length === 0) return { sentCount: 0 }

  // Identidade (nome/telefone) dos destinatários vem de profiles.
  const { data: recipients, error: recipientsErr } = await adminClient
    .from('profiles')
    .select('id, full_name, phone')
    .in('id', memberIds)
  if (recipientsErr) return { error: 'Erro ao buscar destinatários.' }
  if (!recipients || recipients.length === 0) return { sentCount: 0 }

  // Insert notification records for all recipients
  const notificationRows = recipients.map((r: { id: string }) => ({
    organization_id: orgId,
    user_id: r.id,
    type,
    title,
    body,
    read: false,
  }))

  const { error: notifErr } = await adminClient
    .from('notifications')
    .insert(notificationRows)

  if (notifErr) return { error: 'Erro ao salvar notificações.' }

  // Send via channels
  if (channels.includes('email')) {
    await _sendEmailNotifications(recipients, title, body)
  }

  if (channels.includes('whatsapp')) {
    await _sendWhatsAppNotifications(recipients, title, body)
  }

  if (channels.includes('push')) {
    // Fetch push subscriptions for these users
    const userIds = recipients.map((r: { id: string }) => r.id)
    const { data: pushSubs } = await adminClient
      .from('push_subscriptions')
      .select('user_id, subscription')
      .in('user_id', userIds)

    if (pushSubs && pushSubs.length > 0) {
      await _sendPushNotifications(pushSubs, title, body)
    }
    // Silently skip if no push subscriptions
  }

  return { sentCount: recipients.length }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _sendEmailNotifications(
  recipients: Array<{ id: string; full_name: string }>,
  title: string,
  body: string,
): Promise<void> {
  // Email via Resend SDK
  // Resend is not installed as a dependency yet — stub for now
  // When resend is added: import { Resend } from 'resend'
  // const resend = new Resend(process.env.RESEND_API_KEY)
  // for (const recipient of recipients) { await resend.emails.send({...}) }
  console.log(`[email] Would send "${title}" to ${recipients.length} recipients`)
}

async function _sendWhatsAppNotifications(
  recipients: Array<{ id: string; full_name: string; phone?: string | null }>,
  title: string,
  body: string,
): Promise<void> {
  // WhatsApp via stub — real gateway TBD (WHATSAPP_GATEWAY env var)
  const gateway = process.env.WHATSAPP_GATEWAY
  if (!gateway) {
    console.log('[whatsapp] WHATSAPP_GATEWAY not configured — skipping')
    return
  }

  // Stub: log the intent; real implementation depends on gateway API
  for (const recipient of recipients) {
    if (recipient.phone) {
      console.log(`[whatsapp] Would send "${title}" to ${recipient.phone} via ${gateway}`)
    }
  }
}

async function _sendPushNotifications(
  pushSubs: Array<{ user_id: string; subscription: unknown }>,
  title: string,
  body: string,
): Promise<void> {
  // Web Push API
  // Requires web-push package and VAPID keys (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  // Silently skip if no push subscriptions or VAPID not configured
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('[push] VAPID keys not configured — skipping push notifications')
    return
  }

  // Stub: log the intent; real implementation uses web-push package
  console.log(`[push] Would send "${title}" to ${pushSubs.length} push subscribers`)
}
