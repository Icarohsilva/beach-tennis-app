'use client'
// app/(dashboard)/comunidade/ComunidadeClient.tsx

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { PostFeed } from '@/features/comunidade/PostFeed'
import { CreatePost } from '@/features/comunidade/CreatePost'
import { SectionHeader } from '@/components/ui/SectionHeader'
import type { Post, Profile } from '@/types'

type PostWithAuthor = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  comment_count: number
}

interface ComunidadeClientProps {
  currentUserId: string
  initialPosts: PostWithAuthor[]
  initialLikedPostIds: string[]
}

export function ComunidadeClient({
  currentUserId,
  initialPosts,
  initialLikedPostIds,
}: ComunidadeClientProps) {
  const [showCreatePost, setShowCreatePost] = useState(false)
  // Posts created in this session — prepended to the feed immediately without server round-trip
  const [localPosts, setLocalPosts] = useState<PostWithAuthor[]>([])

  function handlePostCreated(newPost: { id: string; organization_id: string; author_id: string; content: string; image_urls: string[]; likes_count: number; session_id: string | null; tournament_id: string | null; created_at: string; author: { id: string; full_name: string; avatar_url: string | null } }) {
    setShowCreatePost(false)
    const fullPost: PostWithAuthor = { ...newPost, comment_count: 0 }
    setLocalPosts((prev) => [fullPost, ...prev])
  }

  return (
    <div className="relative min-h-full pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
        <SectionHeader title="Comunidade" />
      </div>

      {/* Feed */}
      <div className="px-4 py-4">
        <PostFeed
          currentUserId={currentUserId}
          initialPosts={initialPosts}
          localPosts={localPosts}
          initialLikedPostIds={initialLikedPostIds}
        />
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowCreatePost(true)}
        className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 active:bg-brand-800 transition-colors flex items-center justify-center"
        aria-label="Criar post"
      >
        <Plus size={24} />
      </button>

      {showCreatePost && (
        <CreatePost
          onClose={() => setShowCreatePost(false)}
          onPostCreated={handlePostCreated}
        />
      )}
    </div>
  )
}
