'use client'
// features/comunidade/CommentList.tsx

import { useState, useEffect, useTransition, useRef } from 'react'
import Image from 'next/image'
import { Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { addComment } from './actions'

interface Comment {
  id: string
  post_id: string
  author_id: string
  content: string
  created_at: string
  author: {
    full_name: string
    avatar_url: string | null
  }
}

interface CommentListProps {
  postId: string
  currentUserId: string
}

export function CommentList({ postId, currentUserId }: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [isPending, startTransition] = useTransition()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const supabase = createClient()

    async function fetchComments() {
      const { data } = await supabase
        .from('post_comments')
        .select('id, post_id, author_id, content, created_at, author:profiles(full_name, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })

      if (data) {
        setComments(
          data.map((c: unknown) => {
            const row = c as {
              id: string
              post_id: string
              author_id: string
              content: string
              created_at: string
              author: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[]
            }
            const author = Array.isArray(row.author) ? row.author[0] : row.author
            return {
              id: row.id,
              post_id: row.post_id,
              author_id: row.author_id,
              content: row.content,
              created_at: row.created_at,
              author: author ?? { full_name: 'Aluno', avatar_url: null },
            }
          }),
        )
      }
      setLoading(false)
    }

    fetchComments()
  }, [postId])

  function handleSubmit() {
    if (!text.trim()) return

    startTransition(async () => {
      const result = await addComment(postId, text.trim())
      if (!result?.error) {
        setText('')
        // Re-fetch comments to get server data
        const supabase = createClient()
        const { data } = await supabase
          .from('post_comments')
          .select('id, post_id, author_id, content, created_at, author:profiles(full_name, avatar_url)')
          .eq('post_id', postId)
          .order('created_at', { ascending: true })

        if (data) {
          setComments(
            data.map((c: unknown) => {
              const row = c as {
                id: string
                post_id: string
                author_id: string
                content: string
                created_at: string
                author: { full_name: string; avatar_url: string | null } | { full_name: string; avatar_url: string | null }[]
              }
              const author = Array.isArray(row.author) ? row.author[0] : row.author
              return {
                id: row.id,
                post_id: row.post_id,
                author_id: row.author_id,
                content: row.content,
                created_at: row.created_at,
                author: author ?? { full_name: 'Aluno', avatar_url: null },
              }
            }),
          )
        }
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-3">
        <div className="h-4 bg-surface-border animate-pulse rounded w-32" />
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-3">
      {comments.length === 0 && (
        <p className="text-slate-500 text-xs">Nenhum comentário ainda. Seja o primeiro!</p>
      )}

      {comments.map((comment) => {
        const initials = comment.author.full_name
          .split(' ')
          .slice(0, 2)
          .map((n) => n[0])
          .join('')
          .toUpperCase()

        return (
          <div key={comment.id} className="flex gap-2">
            {comment.author.avatar_url ? (
              <Image
                src={comment.author.avatar_url}
                alt={comment.author.full_name}
                width={28}
                height={28}
                className="rounded-full object-cover w-7 h-7 flex-shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {initials}
              </div>
            )}
            <div className="bg-surface rounded-lg px-3 py-2 min-w-0">
              <p className="text-white text-xs font-semibold">{comment.author.full_name}</p>
              <p className="text-slate-300 text-sm">{comment.content}</p>
            </div>
          </div>
        )
      })}

      {/* New comment input */}
      <div className="flex gap-2 items-end pt-1">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Adicionar comentário…"
          rows={1}
          disabled={isPending}
          className="flex-1 resize-none rounded-lg bg-surface border border-surface-border px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isPending || !text.trim()}
          className="p-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Enviar comentário"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
