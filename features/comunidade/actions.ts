'use server'
// features/comunidade/actions.ts

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, getActiveOrgId } from '@/lib/supabase/server'
import type { StudentLevel, PaymentType, CheckinPartner } from '@/types'
import { notifyUsers, type NotificationChannel } from '@/lib/notifications/dispatch'

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
}): Promise<{ error?: string; post?: { id: string; organization_id: string; author_id: string; content: string; image_urls: string[]; likes_count: number; is_pinned: boolean; session_id: string | null; tournament_id: string | null; created_at: string; author: { id: string; full_name: string; avatar_url: string | null } } }> {
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
      is_pinned: false,
      session_id: sessionId ?? null,
      tournament_id: tournamentId ?? null,
    })
    .select('id, created_at')
    .single()

  if (insertErr || !post) return { error: 'Erro ao criar post. Tente novamente.' }

  revalidatePath('/comunidade')
  revalidatePath('/liga')

  const p = post as { id: string; created_at: string }
  return {
    post: {
      id: p.id,
      organization_id: orgId,
      author_id: user.id,
      content: content.trim(),
      image_urls: imageUrls,
      likes_count: 0,
      is_pinned: false,
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
  revalidatePath('/liga')
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
  revalidatePath('/liga')
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
  revalidatePath('/liga')
  return { commentId: comment.id }
}

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

/**
 * Envia uma notificacao para um conjunto filtrado de alunos via notifyUsers.
 * - In-app sempre (canal garantido); e-mail/WhatsApp best-effort quando o canal
 *   estiver marcado na UI.
 * - O contador de "enviados" reflete os destinatarios in-app (como antes).
 *
 * Filtros: 'all' | 'by_level' | 'by_plan'. ('pwa_only' fica indisponivel — push
 * chega na proxima etapa; a tabela push_subscriptions nem existe.)
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

  if (filterMode === 'pwa_only') {
    return { error: 'Filtro indisponível (push chega na próxima etapa).' }
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
    // 'subscriber'/'per_class' filtram cobrança; 'wellhub'/'totalpass' filtram parceiro.
    if (filterValue === 'wellhub' || filterValue === 'totalpass') {
      memQuery = memQuery.eq('partner', filterValue as CheckinPartner)
    } else {
      memQuery = memQuery.eq('payment_type', filterValue as PaymentType)
    }
  }

  const { data: members, error: membersErr } = await memQuery
  if (membersErr) return { error: 'Erro ao buscar destinatários.' }
  const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id)

  if (memberIds.length === 0) return { sentCount: 0 }

  // Identidade (telefone) dos destinatários vem de profiles.
  const { data: recipients, error: recipientsErr } = await adminClient
    .from('profiles')
    .select('id, phone')
    .in('id', memberIds)
  if (recipientsErr) return { error: 'Erro ao buscar destinatários.' }
  if (!recipients || recipients.length === 0) return { sentCount: 0 }

  // E-mails via view somente-leitura (profiles não tem e-mail — ele vive em auth.users).
  const { data: emailRows } = await adminClient
    .from('user_emails')
    .select('id, email')
    .in('id', memberIds)
  const emailById = new Map(
    ((emailRows ?? []) as { id: string; email: string }[]).map((r) => [r.id, r.email]),
  )

  // In-app sempre; e-mail/WhatsApp/push conforme marcado na UI.
  const notifyChannels: NotificationChannel[] = ['inapp']
  if (channels.includes('email')) notifyChannels.push('email')
  if (channels.includes('whatsapp')) notifyChannels.push('whatsapp')
  if (channels.includes('push')) notifyChannels.push('push')

  try {
    await notifyUsers(adminClient, {
      orgId,
      recipients: (recipients as { id: string; phone: string | null }[]).map((r) => ({
        userId: r.id,
        email: emailById.get(r.id) ?? null,
        phone: r.phone,
      })),
      type,
      title,
      body,
      channels: notifyChannels,
    })
  } catch {
    // Falha do in-app (nosso banco) é o único caso que chega aqui — notifyUsers
    // isola e-mail/WhatsApp internamente.
    return { error: 'Erro ao salvar notificações.' }
  }

  return { sentCount: recipients.length }
}

// ---------------------------------------------------------------------------
// togglePinPost (admin only) — mural de comunicados
// ---------------------------------------------------------------------------

/**
 * Fixa ou desafixa um post no topo do feed. Só admin da academia ativa.
 *
 * É o que transforma o feed em canal oficial e não só em conversa: o comunicado da
 * academia para de se perder embaixo das fotos do fim de semana.
 */
export async function togglePinPost(postId: string): Promise<{ error?: string; pinned?: boolean }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }

  const adminClient = createAdminClient()
  const orgId = await getActiveOrgId()
  if (!orgId) return { error: 'Academia ativa não encontrada.' }

  const { data: callerMembership } = await adminClient
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .single()
  if (callerMembership?.role !== 'admin') return { error: 'Sem permissão.' }

  // O post precisa ser da academia ativa: sem este filtro, um admin fixaria post de
  // outra arena passando o id na mão.
  const { data: post } = await adminClient
    .from('posts')
    .select('id, is_pinned')
    .eq('id', postId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!post) return { error: 'Post não encontrado.' }

  const next = !(post as { is_pinned: boolean }).is_pinned
  const { error } = await adminClient
    .from('posts')
    .update({ is_pinned: next })
    .eq('id', postId)
    .eq('organization_id', orgId)

  if (error) return { error: 'Erro ao fixar o post.' }

  revalidatePath('/liga')
  revalidatePath('/comunidade')
  return { pinned: next }
}
