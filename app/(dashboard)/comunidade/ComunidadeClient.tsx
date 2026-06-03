'use client'
// app/(dashboard)/comunidade/ComunidadeClient.tsx

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { PostFeed } from '@/features/comunidade/PostFeed'
import { CreatePost } from '@/features/comunidade/CreatePost'
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
  const router = useRouter()
  const [showCreatePost, setShowCreatePost] = useState(false)

  function handlePostCreated() {
    setShowCreatePost(false)
    router.refresh()  // Re-runs the server component → initialPosts gets the new post
  }

  return (
    <div className="relative min-h-full pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface border-b border-surface-border px-4 py-3">
        <h1 className="text-lg font-bold text-white">Comunidade</h1>
      </div>

      {/* Feed */}
      <div className="px-4 py-4">
        <PostFeed
          currentUserId={currentUserId}
          initialPosts={initialPosts}
          initialLikedPostIds={initialLikedPostIds}
        />
      </div>

      {/* FAB — Floating Action Button */}
      <button
        onClick={() => setShowCreatePost(true)}
        className="fixed bottom-20 right-4 z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 active:bg-brand-800 transition-colors flex items-center justify-center"
        aria-label="Criar post"
      >
        <Plus size={24} />
      </button>

      {/* Create Post Modal */}
      {showCreatePost && (
        <CreatePost
          onClose={() => setShowCreatePost(false)}
          onPostCreated={handlePostCreated}
        />
      )}
    </div>
  )
}
