'use client'
// features/comunidade/PostCard.tsx

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Heart, MessageCircle, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import type { Post, Profile } from '@/types'
import { toggleLike } from './actions'
import { CommentList } from './CommentList'

type PostWithCount = Post & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
  comment_count: number
}

interface PostCardProps {
  post: PostWithCount
  currentUserId: string
  initialLiked: boolean
}

export function PostCard({ post, currentUserId, initialLiked }: PostCardProps) {
  const [liked, setLiked] = useState(initialLiked)
  const [likesCount, setLikesCount] = useState(post.likes_count)
  const [commentCount, setCommentCount] = useState(post.comment_count)
  const [showComments, setShowComments] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleToggleLike() {
    const wasLiked = liked
    setLiked(!wasLiked)
    setLikesCount((prev) => (wasLiked ? prev - 1 : prev + 1))
    startTransition(async () => {
      const result = await toggleLike(post.id)
      if (result?.error) {
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

  const images = post.image_urls ?? []

  return (
    <>
      <Card className="p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-4">
          {post.author.avatar_url ? (
            <Image
              src={post.author.avatar_url}
              alt={post.author.full_name}
              width={40}
              height={40}
              className="rounded-full object-cover w-10 h-10 flex-shrink-0"
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

        {/* Text content */}
        {post.content && (
          <div className="px-4 pb-3">
            <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{post.content}</p>
          </div>
        )}

        {/* Image gallery */}
        {images.length > 0 && (
          <div
            className={`grid gap-0.5 ${
              images.length === 1
                ? 'grid-cols-1'
                : images.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2'
            }`}
          >
            {images.slice(0, 4).map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightboxUrl(url)}
                className={`relative block w-full ${
                  images.length === 1 ? 'aspect-video' : 'aspect-square'
                } overflow-hidden`}
              >
                <Image
                  src={url}
                  alt={`Imagem ${i + 1}`}
                  fill
                  className="object-cover hover:opacity-90 transition-opacity"
                  sizes="(max-width: 640px) 50vw, 400px"
                />
                {i === 3 && images.length > 4 && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <span className="text-white text-2xl font-bold">+{images.length - 4}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-5 px-4 py-3 border-t border-surface-border">
          <button
            onClick={handleToggleLike}
            disabled={isPending}
            className="flex items-center gap-1.5 transition-colors disabled:opacity-50"
            aria-label={liked ? 'Descurtir' : 'Curtir'}
          >
            <Heart
              size={20}
              className={liked ? 'fill-red-500 text-red-500' : 'text-slate-400 hover:text-red-400'}
            />
            <span className={`text-sm ${liked ? 'text-red-400' : 'text-slate-400'}`}>
              {likesCount > 0 ? likesCount : ''}
            </span>
          </button>

          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            aria-label="Comentários"
          >
            <MessageCircle size={20} className={showComments ? 'text-brand-400' : ''} />
            <span className="text-sm">
              {commentCount > 0 ? commentCount : 'Comentar'}
            </span>
          </button>
        </div>

        {/* Comments section */}
        {showComments && (
          <div className="border-t border-surface-border">
            <CommentList
              postId={post.id}
              currentUserId={currentUserId}
              onCommentAdded={() => setCommentCount((c) => c + 1)}
            />
          </div>
        )}
      </Card>

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightboxUrl(null)}
            aria-label="Fechar"
          >
            <X size={28} />
          </button>
          <div className="relative max-w-2xl w-full max-h-[85vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Imagem ampliada"
              className="w-full h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  )
}
