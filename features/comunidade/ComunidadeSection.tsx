'use client'
// features/comunidade/ComunidadeSection.tsx
// O feed como SEÇÃO (spec §Fase 3), sem cabeçalho próprio nem rota própria.
//
// Nasceu de ComunidadeClient quando a comunidade virou parte da Liga: lá o feed era a
// tela inteira, aqui ele divide espaço com ranking, medalhas e elogios. O botão de
// publicar é inline em vez de flutuante — um FAB fixo brigaria com a barra de
// navegação e com o resto da página.
import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { PostFeed } from './PostFeed'
import { CreatePost } from './CreatePost'
import type { PostWithAuthor } from './feed'

interface Props {
  currentUserId: string
  activeOrgId: string
  initialPosts: PostWithAuthor[]
  initialLikedPostIds: string[]
  canPin: boolean
}

export function ComunidadeSection({
  currentUserId,
  activeOrgId,
  initialPosts,
  initialLikedPostIds,
  canPin,
}: Props) {
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [localPosts, setLocalPosts] = useState<PostWithAuthor[]>([])

  function handlePostCreated(newPost: Omit<PostWithAuthor, 'comment_count'>) {
    setShowCreatePost(false)
    setLocalPosts((prev) => [{ ...newPost, comment_count: 0 }, ...prev])
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs tracking-wide text-slate-400">COMUNIDADE</p>
        <button
          onClick={() => setShowCreatePost(true)}
          className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-500 transition-colors hover:bg-brand-500/20"
        >
          <PenLine className="h-3 w-3" />
          Publicar
        </button>
      </div>

      <PostFeed
        currentUserId={currentUserId}
        activeOrgId={activeOrgId}
        initialPosts={initialPosts}
        localPosts={localPosts}
        initialLikedPostIds={initialLikedPostIds}
        canPin={canPin}
      />

      {showCreatePost && (
        <CreatePost
          onClose={() => setShowCreatePost(false)}
          onPostCreated={handlePostCreated}
        />
      )}
    </section>
  )
}
