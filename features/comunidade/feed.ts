// features/comunidade/feed.ts
// Carga inicial do feed. Extraída da página de /comunidade quando o feed virou uma
// seção da Liga (spec §Fase 3) — as duas rotas leem exatamente o mesmo estado.
import { createAdminClient } from '@/lib/supabase/server'
import type { Post, Profile } from '@/types'

export type PostWithAuthor = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  comment_count: number
}

export interface FeedData {
  posts: PostWithAuthor[]
  likedPostIds: string[]
}

const PAGE_SIZE = 20

const POST_COLUMNS =
  'id, author_id, content, image_urls, likes_count, is_pinned, session_id, tournament_id, created_at, author:profiles(id, full_name, avatar_url)'

export async function getFeedData(orgId: string, userId: string): Promise<FeedData> {
  const admin = createAdminClient()

  // Fixado primeiro: é o mural de comunicados da academia. Depois, o mais recente.
  const { data: postsRaw } = await admin
    .from('posts')
    .select(POST_COLUMNS)
    .eq('organization_id', orgId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  const rows = (postsRaw ?? []) as unknown as (Record<string, unknown> & { id: string })[]
  const postIds = rows.map((p) => p.id)

  const { data: commentRows } = postIds.length
    ? await admin.from('post_comments').select('post_id').in('post_id', postIds)
    : { data: [] as { post_id: string }[] }

  const commentCount: Record<string, number> = {}
  for (const c of (commentRows ?? []) as { post_id: string }[]) {
    commentCount[c.post_id] = (commentCount[c.post_id] ?? 0) + 1
  }

  const { data: likes } = postIds.length
    ? await admin.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', postIds)
    : { data: [] as { post_id: string }[] }

  const posts: PostWithAuthor[] = rows.map((d) => {
    const authorRaw = Array.isArray(d.author) ? (d.author as unknown[])[0] : d.author
    return {
      id: d.id,
      organization_id: orgId,
      author_id: d.author_id as string,
      content: d.content as string,
      image_urls: (d.image_urls as string[]) ?? [],
      likes_count: (d.likes_count as number) ?? 0,
      is_pinned: (d.is_pinned as boolean) ?? false,
      session_id: (d.session_id as string | null) ?? null,
      tournament_id: (d.tournament_id as string | null) ?? null,
      created_at: d.created_at as string,
      comment_count: commentCount[d.id] ?? 0,
      author: (authorRaw as Pick<Profile, 'id' | 'full_name' | 'avatar_url'>) ?? {
        id: d.author_id as string,
        full_name: 'Aluno',
        avatar_url: null,
      },
    }
  })

  return {
    posts,
    likedPostIds: ((likes ?? []) as { post_id: string }[]).map((l) => l.post_id),
  }
}
