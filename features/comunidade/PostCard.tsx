'use client'
// features/comunidade/PostCard.tsx

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Heart, MessageCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { Post, Profile } from '@/types'
import { toggleLike } from './actions'
import { CommentList } from './CommentList'

interface PostCardProps {
  post: Post & { author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> }
  currentUserId: string
  initialLiked: boolean
}

export function PostCard({ post, currentUserId, initialLiked }: PostCardProps) {
  const [liked, setLiked] = useState(initialLiked)
  const [likesCount, setLikesCount] = useState(post.likes_count)
  const [showComments, setShowComments] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleToggleLike() {
    const wasLiked = liked
    // Optimistic update
    setLiked(!wasLiked)
    setLikesCount((prev) => (wasLiked ? prev - 1 : prev + 1))

    startTransition(async () => {
      const result = await toggleLike(post.id)
      if (result?.error) {
        // Rollback on error
        setLiked(wasLiked)
        setLikesCount((prev) => (wasLiked ? prev + 1 : prev - 1))
      }
    })
  }

  const initials = post.author.full_name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  const formattedDate = new Date(post.created_at).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        {post.author.avatar_url ? (
          <Image
            src={post.author.avatar_url}
            alt={post.author.full_name}
            width={40}
            height={40}
            className="rounded-full object-cover w-10 h-10"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">{post.author.full_name}</p>
          <p className="text-slate-400 text-xs">{formattedDate}</p>
        </div>
      </div>

      {/* Content */}
      {post.content && (
        <div className="px-4 pb-3">
          <p className="text-slate-200 text-sm whitespace-pre-wrap">{post.content}</p>
        </div>
      )}

      {/* Image gallery */}
      {post.image_urls && post.image_urls.length > 0 && (
        <div
          className={`grid gap-0.5 ${
            post.image_urls.length === 1
              ? 'grid-cols-1'
              : post.image_urls.length === 2
                ? 'grid-cols-2'
                : 'grid-cols-2'
          }`}
        >
          {post.image_urls.slice(0, 4).map((url, i) => (
            <div key={url} className={`relative ${post.image_urls.length === 1 ? 'aspect-video' : 'aspect-square'}`}>
              <Image
                src={url}
                alt={`Imagem ${i + 1}`}
                fill
                className="object-cover"
              />
              {i === 3 && post.image_urls.length > 4 && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <span className="text-white text-lg font-bold">+{post.image_urls.length - 4}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-4 px-4 py-3 border-t border-surface-border">
        <button
          onClick={handleToggleLike}
          disabled={isPending}
          className="flex items-center gap-1.5 text-sm transition-colors disabled:opacity-50"
          aria-label={liked ? 'Descurtir' : 'Curtir'}
        >
          <Heart
            size={18}
            className={liked ? 'fill-red-500 text-red-500' : 'text-slate-400 hover:text-red-400'}
          />
          <span className={liked ? 'text-red-400' : 'text-slate-400'}>{likesCount}</span>
        </button>

        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          aria-label="Comentários"
        >
          <MessageCircle size={18} />
          <span>Comentários</span>
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <div className="border-t border-surface-border">
          <CommentList postId={post.id} currentUserId={currentUserId} />
        </div>
      )}
    </Card>
  )
}
