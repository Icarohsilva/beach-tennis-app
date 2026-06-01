// app/(dashboard)/comunidade/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ComunidadeClient } from './ComunidadeClient'
import type { Post, Profile } from '@/types'

type PostWithAuthor = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

export default async function ComunidadePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch initial posts (server-side for SSR)
  const { data: postsRaw } = await supabase
    .from('posts')
    .select('id, author_id, content, image_urls, likes_count, session_id, tournament_id, created_at, author:profiles(id, full_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(10)

  const initialPosts: PostWithAuthor[] = (postsRaw ?? []).map((d) => {
    const authorRaw = Array.isArray((d as { author: unknown }).author)
      ? (d as { author: unknown[] }).author[0]
      : (d as { author: unknown }).author
    return {
      id: d.id,
      author_id: d.author_id,
      content: d.content,
      image_urls: d.image_urls ?? [],
      likes_count: d.likes_count ?? 0,
      session_id: d.session_id,
      tournament_id: d.tournament_id,
      created_at: d.created_at,
      author: (authorRaw as Pick<Profile, 'id' | 'full_name' | 'avatar_url'>) ?? {
        id: d.author_id,
        full_name: 'Aluno',
        avatar_url: null,
      },
    }
  })

  // Fetch which posts the current user has liked
  const postIds = initialPosts.map((p) => p.id)
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
      initialPosts={initialPosts}
      initialLikedPostIds={initialLikedPostIds}
    />
  )
}
