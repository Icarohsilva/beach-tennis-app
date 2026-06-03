'use client'
// features/comunidade/PostFeed.tsx

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PostCard } from './PostCard'
import type { Post, Profile } from '@/types'

type PostWithAuthor = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  comment_count: number
}

interface PostFeedProps {
  currentUserId: string
  initialPosts: PostWithAuthor[]
  localPosts: PostWithAuthor[]
  initialLikedPostIds: string[]
}

const PAGE_SIZE = 20

export function PostFeed({ currentUserId, initialPosts, localPosts, initialLikedPostIds }: PostFeedProps) {
  const [serverPosts, setServerPosts] = useState<PostWithAuthor[]>(initialPosts)
  const [likedPostIds] = useState<Set<string>>(new Set(initialLikedPostIds))
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initialPosts.length === PAGE_SIZE)
  const [loadingMore, setLoadingMore] = useState(false)

  // Merge: local (just created) + server posts, deduplicating
  const localIds = new Set(localPosts.map((p) => p.id))
  const posts = [...localPosts, ...serverPosts.filter((p) => !localIds.has(p.id))]

  // Realtime: prepend new posts when inserted
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('posts-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        async (payload) => {
          const { data } = await supabase
            .from('posts')
            .select('id, author_id, content, image_urls, likes_count, session_id, tournament_id, created_at, author:profiles(id, full_name, avatar_url)')
            .eq('id', payload.new.id)
            .single()

          if (data) {
            const authorRaw = Array.isArray((data as { author: unknown }).author)
              ? (data as { author: unknown[] }).author[0]
              : (data as { author: unknown }).author
            const newPost: PostWithAuthor = {
              id: data.id,
              author_id: data.author_id,
              content: data.content,
              image_urls: data.image_urls ?? [],
              likes_count: data.likes_count ?? 0,
              session_id: data.session_id,
              tournament_id: data.tournament_id,
              created_at: data.created_at,
              comment_count: 0,
              author: (authorRaw as Pick<Profile, 'id' | 'full_name' | 'avatar_url'>) ?? {
                id: data.author_id,
                full_name: 'Aluno',
                avatar_url: null,
              },
            }
            setServerPosts((prev) => {
              if (prev.some((p) => p.id === newPost.id)) return prev
              return [newPost, ...prev]
            })
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)

    const supabase = createClient()
    const { data } = await supabase
      .from('posts')
      .select('id, author_id, content, image_urls, likes_count, session_id, tournament_id, created_at, author:profiles(id, full_name, avatar_url)')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (data && data.length > 0) {
      const postIds = data.map((d: { id: string }) => d.id)

      // Fetch comment counts for new batch
      const { data: ccRaw } = await supabase
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds)

      const ccMap: Record<string, number> = {}
      for (const c of (ccRaw ?? []) as { post_id: string }[]) {
        ccMap[c.post_id] = (ccMap[c.post_id] ?? 0) + 1
      }

      const newPosts: PostWithAuthor[] = data.map((d) => {
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
          comment_count: ccMap[d.id] ?? 0,
          author: (authorRaw as Pick<Profile, 'id' | 'full_name' | 'avatar_url'>) ?? {
            id: d.author_id,
            full_name: 'Aluno',
            avatar_url: null,
          },
        }
      })
      setServerPosts((prev) => [...prev, ...newPosts])
      setPage((prev) => prev + 1)
      setHasMore(data.length === PAGE_SIZE)
    } else {
      setHasMore(false)
    }

    setLoadingMore(false)
  }, [loadingMore, hasMore, page])

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-5xl mb-4">🎾</div>
        <p className="text-slate-300 font-medium">Nenhum post ainda</p>
        <p className="text-slate-500 text-sm mt-1">Seja o primeiro a compartilhar algo!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          currentUserId={currentUserId}
          initialLiked={likedPostIds.has(post.id)}
        />
      ))}

      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-sm text-brand-500 hover:text-brand-400 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </button>
        </div>
      )}

      {!hasMore && posts.length > 0 && (
        <p className="text-center text-slate-500 text-xs py-4">Você viu todos os posts</p>
      )}
    </div>
  )
}
