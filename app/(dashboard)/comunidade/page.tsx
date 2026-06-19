// app/(dashboard)/comunidade/page.tsx
export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getCurrentOrgId } from '@/lib/supabase/server'
import { ComunidadeClient } from './ComunidadeClient'
import type { Post, Profile } from '@/types'

type PostWithAuthor = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  comment_count: number
}

export default async function ComunidadePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const orgId = await getCurrentOrgId()

  // Fetch initial posts — adminClient bypasses RLS, então escopamos pela academia.
  const { data: postsRaw } = await adminClient
    .from('posts')
    .select('id, author_id, content, image_urls, likes_count, session_id, tournament_id, created_at, author:profiles(id, full_name, avatar_url)')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20)

  const postIds = (postsRaw ?? []).map((p: { id: string }) => p.id)

  // Fetch comment counts for initial posts
  const { data: commentCountsRaw } = postIds.length > 0
    ? await adminClient
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds)
    : { data: [] }

  const commentCountMap: Record<string, number> = {}
  for (const c of (commentCountsRaw ?? []) as { post_id: string }[]) {
    commentCountMap[c.post_id] = (commentCountMap[c.post_id] ?? 0) + 1
  }

  const initialPosts: PostWithAuthor[] = (postsRaw ?? []).map((d) => {
    const authorRaw = Array.isArray((d as { author: unknown }).author)
      ? (d as { author: unknown[] }).author[0]
      : (d as { author: unknown }).author
    return {
      id: d.id,
      organization_id: orgId as string,
      author_id: d.author_id,
      content: d.content,
      image_urls: d.image_urls ?? [],
      likes_count: d.likes_count ?? 0,
      session_id: d.session_id,
      tournament_id: d.tournament_id,
      created_at: d.created_at,
      comment_count: commentCountMap[d.id] ?? 0,
      author: (authorRaw as Pick<Profile, 'id' | 'full_name' | 'avatar_url'>) ?? {
        id: d.author_id,
        full_name: 'Aluno',
        avatar_url: null,
      },
    }
  })

  // Fetch which posts the current user has liked
  let initialLikedPostIds: string[] = []
  if (postIds.length > 0) {
    const { data: likes } = await supabase
      .from('post_likes')
      .select('post_id')
      .eq('user_id', user.id)
      .in('post_id', postIds)
    initialLikedPostIds = (likes ?? []).map((l: { post_id: string }) => l.post_id)
  }

  return (
    <ComunidadeClient
      currentUserId={user.id}
      activeOrgId={orgId as string}
      initialPosts={initialPosts}
      initialLikedPostIds={initialLikedPostIds}
    />
  )
}
